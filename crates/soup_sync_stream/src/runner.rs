//! The lane loop: runs each lane's pages in order and turns them into frames.

#[cfg(test)]
mod test;

use crate::frame::{EndReason, Frame, LaneDoneReason};
use crate::lane::{INPUT_VARIABLE, LaneId, LanePaging, LanePlan};
use crate::plan::resume_checkpoint;
use crate::request::SyncPlan;
use async_graphql::{Request, Variables};
use bytes::Bytes;
use futures::{Stream, StreamExt as _, stream};
use serde_json::{Map, Value};
use std::collections::{HashSet, VecDeque};
use std::time::Duration;
use tokio::time::Instant;
use tracing::{Instrument as _, Span, field::Empty};

/// Longest one page may run. Under the load balancer's 60 s idle timeout, so
/// a slow page fails its lane instead of the connection dropping.
const PAGE_TIMEOUT: Duration = Duration::from_secs(45);
/// Longest a stream runs before it ends with `deadline`. Bounds how long one
/// stream holds a server slot; the client resumes its lanes in a later stream.
const STREAM_DEADLINE: Duration = Duration::from_secs(5 * 60);
/// How long a stream waits for its turn before it sends `waiting`. Well under
/// the load balancer's 60 s idle timeout, so a queued stream stays connected.
const WAITING_INTERVAL: Duration = Duration::from_secs(10);

/// A response field the loop reads: its JSON pointer and its name in messages.
struct ResponseField {
    pointer: &'static str,
    name: &'static str,
}

const SOUP_ITEMS: ResponseField = ResponseField {
    pointer: "/data/user/soup/items",
    name: "data.user.soup.items",
};
const SOUP_NEXT_CURSOR: ResponseField = ResponseField {
    pointer: "/data/user/soup/nextCursor",
    name: "data.user.soup.nextCursor",
};
const CALENDAR_NODES: ResponseField = ResponseField {
    pointer: "/data/user/calendarOccurrences/nodes",
    name: "data.user.calendarOccurrences.nodes",
};
const CALENDAR_HAS_NEXT_PAGE: ResponseField = ResponseField {
    pointer: "/data/user/calendarOccurrences/hasNextPage",
    name: "data.user.calendarOccurrences.hasNextPage",
};
const CALENDAR_END_CURSOR: &str = "/data/user/calendarOccurrences/endCursor";
const RESPONSE_ERRORS: &str = "errors";
const SOUP_CONTINUATION: &str = "continuation";
const SOUP_CURSOR: &str = "cursor";
const CALENDAR_AFTER: &str = "after";
/// Sent in place of a frame that cannot be encoded; matches `Frame::End { reason: Error }`.
const END_ERROR_LINE: &[u8] = b"{\"type\":\"end\",\"reason\":\"error\"}\n";
/// Recorded as the end reason when the body is dropped before `end`.
const INTERRUPTED: &str = "interrupted";

/// Runs one page of a lane through the server's GraphQL schema with the
/// caller's request context, as `POST /soup/graphql` would.
pub trait PageExecutor: Send + Sync + 'static {
    /// Why a page produced no GraphQL response.
    type Error: std::error::Error + Send + Sync + 'static;
    /// Holds the stream's turn while one page runs; dropped when the page ends.
    type Turn: Send;

    /// Waits until the stream may run its next page. The loop drops a wait
    /// that outlasts `WAITING_INTERVAL` and asks again, so a wait must hold
    /// no place in line that a later call would lose.
    fn turn(&self) -> impl Future<Output = Self::Turn> + Send;

    /// Executes `request` and returns its GraphQL response (`data`, optional
    /// `errors`) as JSON.
    fn execute(&self, request: Request) -> impl Future<Output = Result<Value, Self::Error>> + Send;
}

/// Why a lane failed, sent as the `laneError` message. Server-chosen text only.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
enum LaneFailure {
    #[error("page could not be executed")]
    Execution,
    #[error("page timed out")]
    Timeout,
    #[error("page response has GraphQL errors")]
    ResponseErrors,
    #[error("page response lacks {0}")]
    MissingField(&'static str),
    #[error("calendar page has a next page but no endCursor")]
    MissingEndCursor,
    #[error("calendar page repeated a cursor")]
    RepeatedCursor,
}

/// The stream's frames, in order. The next page runs only when the stream is
/// polled past the previous frames; dropping the stream stops the loop.
/// Fused: polling after the end keeps returning `None`.
pub fn frames<E: PageExecutor>(
    plan: SyncPlan,
    executor: E,
) -> impl Stream<Item = Frame> + Send + 'static {
    stream::unfold(Runner::new(plan, executor), |mut runner| async move {
        let frame = runner.next_frame().await?;
        Some((frame, runner))
    })
    .fuse()
}

/// [`frames`] encoded as NDJSON lines, traced as one `soup.sync_stream` span.
/// Fused, because HTTP bodies can be polled again after they end (the gzip
/// response layer does): a bare `unfold` panics on that poll.
pub fn ndjson_stream<E: PageExecutor>(
    plan: SyncPlan,
    executor: E,
) -> impl Stream<Item = Bytes> + Send + 'static {
    stream::unfold(Some(Runner::new(plan, executor)), |runner| async move {
        let mut runner = runner?;
        let frame = runner.next_frame().await?;
        match frame.to_line() {
            Ok(line) => {
                runner.telemetry.add_bytes(line.len());
                Some((line, Some(runner)))
            }
            Err(error) => {
                tracing::error!(
                    parent: &runner.telemetry.span,
                    error = %error,
                    "soup sync stream frame failed to encode"
                );
                runner.telemetry.add_bytes(END_ERROR_LINE.len());
                runner.telemetry.end = Some(EndReason::Error);
                Some((Bytes::from_static(END_ERROR_LINE), None))
            }
        }
    })
    .fuse()
}

struct Runner<E> {
    executor: E,
    lanes: std::vec::IntoIter<LanePlan>,
    /// The lane with a next page to run.
    lane: Option<LaneRun>,
    /// Frames produced but not yet handed to the reader.
    pending: VecDeque<Frame>,
    pages_run: u32,
    max_pages: Option<u32>,
    /// When the stream stops starting pages and ends with `deadline`.
    deadline: Instant,
    /// When the stream began waiting for the turn it has yet to get.
    waiting_since: Option<Instant>,
    finished: bool,
    telemetry: StreamTelemetry,
}

impl<E: PageExecutor> Runner<E> {
    fn new(plan: SyncPlan, executor: E) -> Self {
        let telemetry = StreamTelemetry::start(&plan);
        Self {
            executor,
            lanes: plan.lanes.into_iter(),
            lane: None,
            pending: VecDeque::new(),
            pages_run: 0,
            max_pages: plan.max_pages,
            deadline: Instant::now() + STREAM_DEADLINE,
            waiting_since: None,
            finished: false,
            telemetry,
        }
    }

    async fn next_frame(&mut self) -> Option<Frame> {
        loop {
            if let Some(frame) = self.pending.pop_front() {
                self.telemetry.observe(&frame);
                return Some(frame);
            }
            if self.finished {
                return None;
            }
            self.step().await;
        }
    }

    async fn step(&mut self) {
        let Some(lane) = self
            .lane
            .take()
            .or_else(|| self.lanes.next().map(LaneRun::new))
        else {
            return self.finish(EndReason::Complete);
        };
        if self.max_pages.is_some_and(|max| self.pages_run >= max) {
            return self.finish(EndReason::MaxPages);
        }
        if Instant::now() >= self.deadline {
            return self.finish(EndReason::Deadline);
        }

        let waiting_since = *self.waiting_since.get_or_insert_with(Instant::now);
        let Ok(turn) = tokio::time::timeout(WAITING_INTERVAL, self.executor.turn()).await else {
            self.lane = Some(lane);
            self.pending.push_back(Frame::Waiting);
            return;
        };
        self.waiting_since = None;
        let waited = waiting_since.elapsed();
        self.telemetry.waited = self.telemetry.waited.saturating_add(waited);

        self.run_page(lane, waited).await;
        drop(turn);
    }

    async fn run_page(&mut self, mut lane: LaneRun, waited: Duration) {
        if !lane.declared {
            lane.declared = true;
            self.pending.push_back(lane.declaration());
        }
        let span = tracing::info_span!(
            parent: &self.telemetry.span,
            "soup.sync_stream.page",
            "sync.lane" = lane.plan.id.as_str(),
            "sync.page" = i64::from(lane.pages),
            "sync.wait_ms" = millis(waited),
            "sync.items" = Empty,
            otel.status_code = Empty,
            otel.status_description = Empty,
        );
        let executed = tokio::time::timeout(
            PAGE_TIMEOUT,
            self.executor
                .execute(lane.request())
                .instrument(span.clone()),
        )
        .await;
        let response = match executed {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                tracing::error!(
                    parent: &span,
                    error = %error,
                    "soup sync stream page failed to execute"
                );
                return self.fail(&span, lane.plan.id, LaneFailure::Execution);
            }
            Err(_) => return self.fail(&span, lane.plan.id, LaneFailure::Timeout),
        };
        self.pages_run = self.pages_run.saturating_add(1);
        let page = lane.pages;
        lane.pages = lane.pages.saturating_add(1);
        let variables = std::mem::take(&mut lane.variables);

        let (items, cursor) = match lane.read_page(&response) {
            Ok(read) => read,
            Err(failure) => {
                let items = lane.plan.paging.item_count(&response);
                span.record("sync.items", i64::from(items));
                self.pending.push_back(Frame::Page {
                    lane: lane.plan.id.clone(),
                    page,
                    variables,
                    response,
                    items,
                    resume: None,
                });
                return self.fail(&span, lane.plan.id, failure);
            }
        };
        span.record("sync.items", i64::from(items));
        lane.items = lane.items.saturating_add(items);
        let pass_items = lane.plan.items_before.saturating_add(lane.items);
        let (next, resume) = match cursor {
            None => (PageNext::Done(LaneDoneReason::Complete), None),
            Some(_) if lane.plan.max_items.is_some_and(|max| pass_items >= max) => {
                (PageNext::Done(LaneDoneReason::MaxItems), None)
            }
            Some(cursor) => {
                let resume = (lane.plan.resumable
                    && matches!(lane.plan.paging, LanePaging::Soup { .. }))
                .then(|| resume_checkpoint(&cursor, pass_items, &lane.plan.pass_started_at));
                (PageNext::Continue(lane.next_variables(cursor)), resume)
            }
        };
        self.pending.push_back(Frame::Page {
            lane: lane.plan.id.clone(),
            page,
            variables,
            response,
            items,
            resume,
        });
        match next {
            PageNext::Continue(variables) => {
                lane.variables = variables;
                self.lane = Some(lane);
            }
            PageNext::Done(reason) => self.pending.push_back(Frame::LaneDone {
                lane: lane.plan.id,
                pages: lane.pages,
                items: lane.items,
                reason,
            }),
        }
    }

    /// Ends the lane with `laneError`, marking its page's span failed; the
    /// stream carries on with the next lane.
    fn fail(&mut self, page: &Span, lane: LaneId, failure: LaneFailure) {
        page.record("otel.status_code", "ERROR");
        page.record("otel.status_description", failure.to_string());
        self.pending.push_back(Frame::LaneError {
            lane,
            message: failure.to_string(),
        });
    }

    fn finish(&mut self, reason: EndReason) {
        self.pending.push_back(Frame::End { reason });
        self.finished = true;
    }
}

/// What follows a page in its lane.
enum PageNext {
    Continue(Map<String, Value>),
    Done(LaneDoneReason),
}

/// A lane in progress.
struct LaneRun {
    plan: LanePlan,
    /// Its `lane` line was sent.
    declared: bool,
    /// What the lane's next page runs.
    variables: Map<String, Value>,
    pages: u32,
    items: u32,
    /// Calendar cursors seen so far, the first input's `after` included.
    seen_cursors: HashSet<String>,
}

impl LaneRun {
    fn new(plan: LanePlan) -> Self {
        let mut seen_cursors = HashSet::new();
        if let LanePaging::Calendar { input } = &plan.paging
            && let Some(Value::String(after)) = input.get(CALENDAR_AFTER)
        {
            seen_cursors.insert(after.clone());
        }
        Self {
            variables: plan.variables.clone(),
            plan,
            declared: false,
            pages: 0,
            items: 0,
            seen_cursors,
        }
    }

    /// The lane's `lane` line.
    fn declaration(&self) -> Frame {
        Frame::Lane {
            lane: self.plan.id.clone(),
            operation_name: self.plan.operation_name.to_owned(),
            paging: self.plan.paging.wire(),
            kind: self.plan.kind.clone(),
            pass_started_at: self.plan.pass_started_at.clone(),
        }
    }

    fn request(&self) -> Request {
        let mut request = Request::new(&*self.plan.query)
            .variables(Variables::from_json(Value::Object(self.variables.clone())))
            .operation_name(self.plan.operation_name);
        request.set_parsed_query(self.plan.document.clone());
        request
    }

    /// The page's item count and next cursor.
    fn read_page(&mut self, response: &Value) -> Result<(u32, Option<String>), LaneFailure> {
        let errors_free = match response.get(RESPONSE_ERRORS) {
            None | Some(Value::Null) => true,
            Some(Value::Array(errors)) => errors.is_empty(),
            Some(_) => false,
        };
        if !errors_free {
            return Err(LaneFailure::ResponseErrors);
        }
        match &self.plan.paging {
            LanePaging::Soup { .. } => {
                let items = array_len(response, &SOUP_ITEMS)?;
                let cursor = match response.pointer(SOUP_NEXT_CURSOR.pointer) {
                    Some(Value::String(cursor)) => Some(cursor.clone()),
                    Some(Value::Null) => None,
                    _ => return Err(LaneFailure::MissingField(SOUP_NEXT_CURSOR.name)),
                };
                Ok((items, cursor))
            }
            LanePaging::Calendar { .. } => {
                let items = array_len(response, &CALENDAR_NODES)?;
                let has_next_page = response
                    .pointer(CALENDAR_HAS_NEXT_PAGE.pointer)
                    .and_then(Value::as_bool)
                    .ok_or(LaneFailure::MissingField(CALENDAR_HAS_NEXT_PAGE.name))?;
                if !has_next_page {
                    return Ok((items, None));
                }
                let cursor = match response.pointer(CALENDAR_END_CURSOR) {
                    Some(Value::String(cursor)) if !cursor.is_empty() => cursor.clone(),
                    _ => return Err(LaneFailure::MissingEndCursor),
                };
                if !self.seen_cursors.insert(cursor.clone()) {
                    return Err(LaneFailure::RepeatedCursor);
                }
                Ok((items, Some(cursor)))
            }
        }
    }

    /// The lane's first variables with the input moved to `cursor`.
    fn next_variables(&self, cursor: String) -> Map<String, Value> {
        let input = match &self.plan.paging {
            LanePaging::Soup { carried } => {
                let mut continuation = Map::new();
                continuation.insert(SOUP_CURSOR.to_owned(), Value::String(cursor));
                continuation.extend(carried.clone());
                let mut input = Map::new();
                input.insert(SOUP_CONTINUATION.to_owned(), Value::Object(continuation));
                input
            }
            LanePaging::Calendar { input } => {
                let mut input = input.clone();
                input.insert(CALENDAR_AFTER.to_owned(), Value::String(cursor));
                input
            }
        };
        let mut variables = self.plan.variables.clone();
        variables.insert(INPUT_VARIABLE.to_owned(), Value::Object(input));
        variables
    }
}

impl LanePaging {
    /// Items in a page, `0` when the page lacks its item list.
    fn item_count(&self, response: &Value) -> u32 {
        let field = match self {
            Self::Soup { .. } => &SOUP_ITEMS,
            Self::Calendar { .. } => &CALENDAR_NODES,
        };
        array_len(response, field).unwrap_or(0)
    }
}

/// `duration` in whole milliseconds, as a span field.
fn millis(duration: Duration) -> i64 {
    span_number(duration.as_millis())
}

/// A count as a span field. The OpenTelemetry layer exports unsigned fields
/// as strings, which cannot be summed or compared, so numbers are `i64`.
fn span_number(value: impl TryInto<i64>) -> i64 {
    value.try_into().unwrap_or(i64::MAX)
}

fn array_len(response: &Value, field: &ResponseField) -> Result<u32, LaneFailure> {
    response
        .pointer(field.pointer)
        .and_then(Value::as_array)
        .map(|items| u32::try_from(items.len()).unwrap_or(u32::MAX))
        .ok_or(LaneFailure::MissingField(field.name))
}

/// The `soup.sync_stream` span and the totals recorded on it when the stream
/// is dropped. Records counts, sizes and ids only, never queries, variables
/// or response content.
struct StreamTelemetry {
    span: Span,
    pages: u32,
    items: u64,
    bytes: u64,
    /// Time the stream's pages spent waiting for their turn.
    waited: Duration,
    failed_lanes: u32,
    end: Option<EndReason>,
}

impl StreamTelemetry {
    fn start(plan: &SyncPlan) -> Self {
        let span = tracing::info_span!(
            "soup.sync_stream",
            "sync.protocol" = i64::from(plan.protocol),
            "sync.pass" = <&'static str>::from(plan.pass),
            "sync.saved_lanes" = span_number(plan.saved_lanes),
            "sync.lane_count" = span_number(plan.lanes.len()),
            "sync.max_pages" = plan.max_pages.map(i64::from),
            "sync.pages" = Empty,
            "sync.items" = Empty,
            "sync.bytes" = Empty,
            "sync.wait_ms" = Empty,
            "sync.end_reason" = Empty,
            "sync.failed_lanes" = Empty,
            "sync.last_failed_lane" = Empty,
            otel.status_code = Empty,
            otel.status_description = Empty,
        );
        Self {
            span,
            pages: 0,
            items: 0,
            bytes: 0,
            waited: Duration::ZERO,
            failed_lanes: 0,
            end: None,
        }
    }

    fn observe(&mut self, frame: &Frame) {
        match frame {
            Frame::Page { items, .. } => {
                self.pages = self.pages.saturating_add(1);
                self.items = self.items.saturating_add(u64::from(*items));
            }
            Frame::Lane { .. } | Frame::LaneDone { .. } | Frame::Waiting => {}
            Frame::LaneError { lane, message } => {
                self.failed_lanes = self.failed_lanes.saturating_add(1);
                self.span.record("sync.last_failed_lane", lane.as_str());
                self.span.record("otel.status_code", "ERROR");
                self.span
                    .record("otel.status_description", message.as_str());
                tracing::warn!(
                    parent: &self.span,
                    sync.lane = lane.as_str(),
                    sync.error = message.as_str(),
                    "soup sync stream lane failed"
                );
            }
            Frame::End { reason } => self.end = Some(*reason),
        }
    }

    fn add_bytes(&mut self, bytes: usize) {
        self.bytes = self
            .bytes
            .saturating_add(u64::try_from(bytes).unwrap_or(u64::MAX));
    }
}

impl Drop for StreamTelemetry {
    fn drop(&mut self) {
        self.span.record("sync.pages", i64::from(self.pages));
        self.span.record("sync.items", span_number(self.items));
        self.span.record("sync.bytes", span_number(self.bytes));
        self.span.record("sync.wait_ms", millis(self.waited));
        self.span
            .record("sync.failed_lanes", i64::from(self.failed_lanes));
        let end_reason: &'static str = self.end.map_or(INTERRUPTED, <&'static str>::from);
        self.span.record("sync.end_reason", end_reason);
    }
}
