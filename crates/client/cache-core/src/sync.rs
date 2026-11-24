//! Streamed cache sync: run arguments, NDJSON frame decoding, and per-run
//! progress.
//!
//! A host (browser worker, native plugin) starts a run with
//! [`crate::engine::Engine::sync_begin`], which builds the request from the
//! [`SyncStartArgs`] and the lanes' saved state, opens one HTTP stream, and
//! feeds the response bytes to the [`SyncRun`]. The server plans the lanes
//! and declares each one on a `lane` line before its pages. The run decodes
//! complete lines into frames; the host applies them one at a time with
//! [`crate::engine::Engine::sync_apply_next`], each application being one
//! engine write. The run itself never touches the network or a clock: hosts
//! supply both. Contract: `docs/architecture/streamed-cache-sync.md`.

mod decoder;

pub use crate::engine::sync::{SyncApplied, SyncHooks, SyncPageWrite, SyncWriteError};
pub use crate::store::SyncStorage;
pub use decoder::{MAX_SYNC_LINE_BYTES, NdjsonDecoder};

use crate::calendar::{CalendarLinkWatermark, CalendarSpan};
use crate::value::EntityKey;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[cfg(test)]
mod test;

/// Most lanes one run accepts from the server's declarations.
pub const MAX_SYNC_LANES: usize = 256;
const MAX_LANE_ID_BYTES: usize = 64;
/// The sync protocol this engine speaks: what it sends and how it reads the
/// lines it gets. Every request carries it, and a server that does not speak
/// it answers 426 instead of streaming. A line type this engine does not know
/// is skipped ([`SyncFrame::Unrecognized`]), so a server can add one an older
/// engine may ignore without a new version; any other change to the request,
/// the lines or their meaning is a new version, which the server must speak
/// before an engine sends it (`soup_sync_stream::PROTOCOL_VERSIONS`).
pub const SYNC_PROTOCOL: u8 = 1;

/// How the server follows one lane's pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncPaging {
    /// `data.user.soup.items`, continued by `nextCursor`.
    Soup,
    /// `data.user.calendarOccurrences.nodes`, continued by `endCursor`.
    Calendar,
}

/// What the cache does with a lane's pages.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncLaneKind {
    /// Write every page; record delivered keys as members of this lane.
    Hydrate,
    /// Collect IDs only; on completion delete members of `scopes` not listed.
    Membership {
        /// Lanes whose members this listing is authoritative for.
        scopes: Vec<String>,
    },
    /// Write every page; on completion commit `coverage` with the lowest watermark.
    Calendar {
        /// Spans the lane's pages fully cover.
        coverage: Vec<CalendarSpan>,
    },
}

/// One lane as the server declared it on its `lane` line.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLane {
    /// `[a-z0-9-]{1,64}`; also the key of the lane's saved state.
    pub id: String,
    /// The query every page of the lane runs.
    pub query: String,
    /// The query's operation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_name: Option<String>,
    /// Where the pages keep their items.
    pub paging: SyncPaging,
    /// What the cache does with the lane's pages.
    pub kind: SyncLaneKind,
    /// ISO time this lane's pass started; stored with the first page, and as
    /// the watermark once the lane completes.
    pub pass_started_at: String,
}

/// The sync pass a run streams; the server plans each pass's lanes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncPass {
    /// What the app needs to filter and show lists locally.
    First,
    /// Everything else, in streams of limited size.
    Second,
}

/// What the server plans calendar windows from, besides the cache's coverage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCalendarArgs {
    /// The app's IANA time zone: the months and local dates it reads
    /// calendars in.
    pub time_zone: String,
}

/// A run request: the stream to open and what the server plans it from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStartArgs {
    /// Absolute stream URL.
    pub url: String,
    /// Extra request headers (mail cache profile, bearer token).
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// The pass to stream.
    pub pass: SyncPass,
    /// End the stream after this many pages (0 sends none); the next run resumes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_pages: Option<u64>,
    /// Sync calendar windows; absent while the app reads calendars elsewhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<SyncCalendarArgs>,
    /// Leave out lanes that completed at or after this ISO time (the
    /// `completedAt` clock): they are current for this run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_since: Option<String>,
    /// Lanes the server leaves out of this stream.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skip_lanes: Vec<String>,
    /// Each lane operation's document by name: the app's own field
    /// selection, which this cache's schema knows. The server runs a lane
    /// only with the document sent for its operation, and the run writes the
    /// lane's pages with it.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub queries: BTreeMap<String, String>,
}

/// Saved per-lane state, read from the cache database.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLaneState {
    /// Lane id.
    pub id: String,
    /// The server's checkpoint from the last written page of an unfinished
    /// pass, sent back to resume it; `None` when no pass is in progress.
    pub resume: Option<Json>,
    /// Pages written in the current (or last) pass.
    pub pages: u64,
    /// Items written in the current (or last) pass.
    pub items: u64,
    /// When the current (or last) pass started.
    pub pass_started_at: Option<String>,
    /// When the last pass completed.
    pub completed_at: Option<String>,
    /// `pass_started_at` of the last completed pass.
    pub watermark: Option<String>,
}

/// One lane's saved state as storage keeps it: an opaque encoded row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncLaneRow {
    /// Lane id.
    pub id: String,
    /// Encoded [`StoredSyncLane`]; only cache-core reads it.
    pub state: String,
}

/// Lane state plus progress that is not part of the public state.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredSyncLane {
    #[serde(flatten)]
    pub(crate) state: SyncLaneState,
    /// Lowest calendar watermark per link across this pass's pages so far.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) pending_watermark: Vec<CalendarLinkWatermark>,
}

impl StoredSyncLane {
    pub(crate) fn decode(row: &SyncLaneRow) -> Result<Self, SyncStreamError> {
        let mut stored: Self = serde_json::from_str(&row.state)
            .map_err(|error| SyncStreamError::State(format!("lane `{}`: {error}", row.id)))?;
        stored.state.id = row.id.clone();
        Ok(stored)
    }

    pub(crate) fn encode(&self) -> SyncLaneRow {
        SyncLaneRow {
            id: self.state.id.clone(),
            // Serializing owned JSON-compatible data cannot fail.
            state: serde_json::to_string(self).unwrap_or_default(),
        }
    }

    /// Starts counting a new pass when the lane names a different one.
    pub(crate) fn begin_pass(&mut self, pass_started_at: &str) {
        if self.state.pass_started_at.as_deref() != Some(pass_started_at) {
            self.state.pass_started_at = Some(pass_started_at.to_owned());
            self.state.pages = 0;
            self.state.items = 0;
            self.state.resume = None;
            self.pending_watermark.clear();
        }
    }
}

/// Why a lane finished.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncLaneDoneReason {
    /// No next cursor.
    Complete,
    /// The lane's `maxItems` was reached.
    MaxItems,
}

/// Why the stream ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncEndReason {
    /// Every lane finished.
    Complete,
    /// The request's `maxPages` was reached.
    MaxPages,
    /// The server stopped the stream at its longest allowed time; lanes
    /// resume from saved state, as after `maxPages`.
    Deadline,
    /// The stream itself failed (lane failures are `laneError` frames).
    Error,
}

/// Standard GraphQL response carried by a page frame.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct SyncPageResponse {
    /// Response data.
    #[serde(default)]
    pub data: Option<Json>,
    /// Response errors.
    #[serde(default)]
    pub errors: Option<Vec<Json>>,
}

/// One decoded NDJSON line.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncFrame {
    /// A lane the stream runs, declared before anything else of it.
    #[serde(rename_all = "camelCase")]
    Lane {
        /// Lane id.
        lane: String,
        /// The operation every page of the lane runs; its document is the
        /// one the request sent.
        operation_name: String,
        /// Where the pages keep their items.
        paging: SyncPaging,
        /// What the cache does with the pages.
        kind: SyncLaneKind,
        /// When the lane's pass started.
        pass_started_at: String,
    },
    /// One executed page of a lane.
    #[serde(rename_all = "camelCase")]
    Page {
        /// Lane id.
        lane: String,
        /// Zero-based page number within the lane in this stream.
        page: u64,
        /// Exactly what the server executed.
        variables: Map<String, Json>,
        /// The page's GraphQL response.
        response: SyncPageResponse,
        /// Items on the page.
        items: u64,
        /// The checkpoint to send back to continue the lane after this page;
        /// `None` when the lane does not resume across streams or is done.
        #[serde(default)]
        resume: Option<Json>,
    },
    /// A lane finished.
    #[serde(rename_all = "camelCase")]
    LaneDone {
        /// Lane id.
        lane: String,
        /// Pages the server sent for the lane in this stream.
        pages: u64,
        /// Items the server sent for the lane in this stream.
        items: u64,
        /// Why it finished.
        reason: SyncLaneDoneReason,
    },
    /// A lane failed: it sends nothing more, and the stream carries on with
    /// the next lane. A page the cache cannot write (GraphQL errors, no paging
    /// fields) comes just before it.
    LaneError {
        /// Lane id.
        lane: String,
        /// Server message.
        message: String,
    },
    /// The server has not yet run the stream's next page: its pages take
    /// turns with other streams'. Nothing to apply.
    Waiting,
    /// The stream ended.
    End {
        /// Why it ended.
        reason: SyncEndReason,
    },
    /// A line type this engine does not know: one a newer server added that
    /// an older engine may skip ([`SYNC_PROTOCOL`]). Nothing to apply. Serde
    /// needs it last.
    #[serde(other)]
    Unrecognized,
}

/// Per-lane summary of one run.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLaneRunSummary {
    /// Lane id.
    pub id: String,
    /// Pages received in this run.
    pub pages: u64,
    /// Items received in this run.
    pub items: u64,
    /// Time spent writing this lane's pages into the cache.
    pub write_ms: f64,
    /// The lane reached `laneDone` in this run.
    pub done: bool,
    /// Why the lane failed in this run, when it did: its `laneError` message,
    /// or the page the cache refused. The run carries on with the other lanes;
    /// the failed lane keeps its saved state, so the next run resumes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// How a successful run ended, as reported to the caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncRunReason {
    /// Every lane finished or failed (see [`SyncLaneRunSummary::error`]).
    Complete,
    /// The run stopped early; the next run resumes from saved state.
    MaxPages,
}

/// Summary of one run.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRunResult {
    /// How the run ended.
    pub reason: SyncRunReason,
    /// Time from the run's start to this summary.
    pub duration_ms: f64,
    /// Response bytes read.
    pub bytes: u64,
    /// Lanes in the order the server declared them.
    pub lanes: Vec<SyncLaneRunSummary>,
}

/// Failures detected without touching the cache.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum SyncStreamError {
    /// The run's arguments break the contract.
    #[error("invalid sync arguments: {0}")]
    Plan(String),
    /// The stream breaks the contract, failed as a whole, or ended early.
    #[error("{0}")]
    Stream(String),
    /// Saved lane state could not be decoded.
    #[error("invalid saved sync state: {0}")]
    State(String),
}

#[derive(Debug, Default)]
pub(crate) struct LaneProgress {
    pub(crate) pages: u64,
    pub(crate) items: u64,
    pub(crate) write_ms: f64,
    pub(crate) done: bool,
    /// Why the lane failed in this run; it applies no more frames.
    pub(crate) error: Option<String>,
    /// The lane's `laneError` arrived (the server sends nothing more for it).
    pub(crate) error_received: bool,
    /// Membership lanes: every key listed so far.
    pub(crate) listed: BTreeSet<EntityKey<'static>>,
}

/// One run: the request, the lanes declared so far, the decoder, decoded
/// frames not yet applied, and progress.
#[derive(Debug)]
pub struct SyncRun {
    /// Lanes in the order the server declared them.
    pub(crate) lanes: Vec<SyncLane>,
    /// Each lane's parsed operation, parsed once per run (some lane queries
    /// are tens of kilobytes and lanes run thousands of pages).
    pub(crate) operations: BTreeMap<String, std::sync::Arc<crate::document::Operation>>,
    request: Json,
    decoder: NdjsonDecoder,
    pub(crate) pending: VecDeque<SyncFrame>,
    pub(crate) progress: BTreeMap<String, LaneProgress>,
    bytes: u64,
    started_at_ms: f64,
    pub(crate) end: Option<SyncEndReason>,
    /// The lane documents the request sent, by operation.
    queries: BTreeMap<String, String>,
}

impl SyncRun {
    /// Builds a run's request from its arguments, every lane's saved state
    /// and, when the run syncs calendars, the cache's calendar coverage, and
    /// starts the run at `started_at_ms` (the host's monotonic clock, the same
    /// one later passed to [`Self::finish`]).
    pub fn new(
        args: &SyncStartArgs,
        saved: &[SyncLaneState],
        coverage: &[CalendarSpan],
        started_at_ms: f64,
    ) -> Result<Self, SyncStreamError> {
        if let Some(id) = args.skip_lanes.iter().find(|id| !is_lane_id(id)) {
            return Err(SyncStreamError::Plan(format!(
                "skipped lane `{id}` is not [a-z0-9-]{{1,64}}"
            )));
        }
        if args
            .calendar
            .as_ref()
            .is_some_and(|calendar| calendar.time_zone.is_empty())
        {
            return Err(SyncStreamError::Plan(
                "calendar needs a time zone".to_owned(),
            ));
        }
        Ok(Self {
            lanes: Vec::new(),
            operations: BTreeMap::new(),
            request: request_body(args, saved, coverage),
            decoder: NdjsonDecoder::default(),
            pending: VecDeque::new(),
            progress: BTreeMap::new(),
            bytes: 0,
            started_at_ms,
            end: None,
            queries: args.queries.clone(),
        })
    }

    /// The document the request sent for a lane's `operation`.
    pub(crate) fn lane_query(
        &self,
        lane: &str,
        operation: &str,
    ) -> Result<String, SyncStreamError> {
        self.queries.get(operation).cloned().ok_or_else(|| {
            SyncStreamError::Stream(format!(
                "lane `{lane}` runs `{operation}`, which the request sent no document for"
            ))
        })
    }

    /// The JSON request body the host sends.
    pub fn request_body(&self) -> &Json {
        &self.request
    }

    /// Adds a lane from its `lane` line.
    pub(crate) fn declare(&mut self, lane: SyncLane) -> Result<(), SyncStreamError> {
        let invalid = |message: String| Err(SyncStreamError::Stream(message));
        if !is_lane_id(&lane.id) {
            return invalid(format!("lane id `{}` is not [a-z0-9-]{{1,64}}", lane.id));
        }
        if self.progress.contains_key(&lane.id) {
            return invalid(format!("lane `{}` was declared twice", lane.id));
        }
        if self.lanes.len() >= MAX_SYNC_LANES {
            return invalid(format!("a stream declares at most {MAX_SYNC_LANES} lanes"));
        }
        match &lane.kind {
            SyncLaneKind::Membership { scopes } => {
                if scopes.is_empty() || scopes.iter().any(|scope| !is_lane_id(scope)) {
                    return invalid(format!(
                        "membership lane `{}` needs lane-id scopes",
                        lane.id
                    ));
                }
            }
            SyncLaneKind::Calendar { coverage } => {
                if lane.paging != SyncPaging::Calendar {
                    return invalid(format!("calendar lane `{}` needs calendar paging", lane.id));
                }
                if coverage.iter().any(|span| span.start > span.end) {
                    return invalid(format!("calendar lane `{}` has an invalid span", lane.id));
                }
            }
            SyncLaneKind::Hydrate => {}
        }
        self.progress
            .insert(lane.id.clone(), LaneProgress::default());
        self.lanes.push(lane);
        Ok(())
    }

    /// Decodes response bytes. Complete lines become pending frames; a
    /// partial line waits for the next chunk. Returns the pending count.
    pub fn push_bytes(&mut self, bytes: &[u8]) -> Result<usize, SyncStreamError> {
        self.bytes += bytes.len() as u64;
        for line in self.decoder.push(bytes)? {
            let frame = serde_json::from_slice::<SyncFrame>(&line)
                .map_err(|error| SyncStreamError::Stream(format!("invalid frame: {error}")))?;
            self.pending.push_back(frame);
        }
        Ok(self.pending.len())
    }

    /// Frames decoded but not yet applied.
    pub fn pending_frames(&self) -> usize {
        self.pending.len()
    }

    /// The lane of the next pending frame and whether it is that lane's
    /// `laneDone`; `None` for `waiting`, `end`, a line type this engine does
    /// not know, or when nothing is pending.
    pub fn peek_frame(&self) -> Option<(&str, bool)> {
        match self.pending.front()? {
            SyncFrame::Lane { lane, .. }
            | SyncFrame::Page { lane, .. }
            | SyncFrame::LaneError { lane, .. } => Some((lane, false)),
            SyncFrame::LaneDone { lane, .. } => Some((lane, true)),
            SyncFrame::Waiting | SyncFrame::Unrecognized | SyncFrame::End { .. } => None,
        }
    }

    /// Whether the stream's `end` frame was applied.
    pub fn ended(&self) -> bool {
        self.end.is_some()
    }

    /// Checks that the response ended cleanly and every frame was applied,
    /// then summarizes the run.
    pub fn finish(&self, now_ms: f64) -> Result<SyncRunResult, SyncStreamError> {
        self.decoder.finish()?;
        if !self.pending.is_empty() {
            return Err(SyncStreamError::Stream(
                "frames were left unapplied".to_owned(),
            ));
        }
        let reason = match self.end {
            Some(SyncEndReason::Complete) => SyncRunReason::Complete,
            Some(SyncEndReason::MaxPages | SyncEndReason::Deadline) => SyncRunReason::MaxPages,
            Some(SyncEndReason::Error) => {
                return Err(SyncStreamError::Stream(
                    "stream ended with an error".to_owned(),
                ));
            }
            None => {
                return Err(SyncStreamError::Stream(
                    "stream closed without an end frame".to_owned(),
                ));
            }
        };
        Ok(self.summary(reason, now_ms))
    }

    /// Progress so far, for a run that stopped before finishing. Reported as
    /// `MaxPages`: the next run resumes from saved state.
    pub fn partial(&self, now_ms: f64) -> SyncRunResult {
        self.summary(SyncRunReason::MaxPages, now_ms)
    }

    fn summary(&self, reason: SyncRunReason, now_ms: f64) -> SyncRunResult {
        SyncRunResult {
            reason,
            duration_ms: (now_ms - self.started_at_ms).max(0.0),
            bytes: self.bytes,
            lanes: self
                .lanes
                .iter()
                .map(|lane| {
                    let progress = self.progress.get(&lane.id);
                    SyncLaneRunSummary {
                        id: lane.id.clone(),
                        pages: progress.map_or(0, |p| p.pages),
                        items: progress.map_or(0, |p| p.items),
                        write_ms: progress.map_or(0.0, |p| p.write_ms),
                        done: progress.is_some_and(|p| p.done),
                        error: progress.and_then(|p| p.error.clone()),
                    }
                })
                .collect(),
        }
    }

    pub(crate) fn lane(&self, id: &str) -> Result<&SyncLane, SyncStreamError> {
        self.lanes
            .iter()
            .find(|lane| lane.id == id)
            .ok_or_else(|| SyncStreamError::Stream(format!("frame names unknown lane `{id}`")))
    }
}

/// The request body: the pass, every lane's saved state, and what the server
/// plans calendar windows from.
fn request_body(args: &SyncStartArgs, saved: &[SyncLaneState], coverage: &[CalendarSpan]) -> Json {
    let lanes = saved
        .iter()
        .map(|state| {
            let mut lane = Map::new();
            lane.insert("id".into(), Json::String(state.id.clone()));
            if let Some(resume) = &state.resume {
                lane.insert("resume".into(), resume.clone());
            }
            if let Some(watermark) = &state.watermark {
                lane.insert("watermark".into(), Json::String(watermark.clone()));
            }
            if let Some(completed_at) = &state.completed_at {
                lane.insert("completedAt".into(), Json::String(completed_at.clone()));
            }
            Json::Object(lane)
        })
        .collect();
    let mut body = Map::new();
    body.insert("protocol".into(), Json::from(SYNC_PROTOCOL));
    body.insert(
        "pass".into(),
        serde_json::to_value(args.pass).unwrap_or(Json::Null),
    );
    body.insert("lanes".into(), Json::Array(lanes));
    if !args.queries.is_empty() {
        body.insert(
            "queries".into(),
            serde_json::to_value(&args.queries).unwrap_or(Json::Null),
        );
    }
    if let Some(calendar) = &args.calendar {
        let mut request = Map::new();
        request.insert("timeZone".into(), Json::String(calendar.time_zone.clone()));
        request.insert(
            "coverage".into(),
            serde_json::to_value(coverage).unwrap_or(Json::Null),
        );
        body.insert("calendar".into(), Json::Object(request));
    }
    if let Some(since) = &args.completed_since {
        body.insert("completedSince".into(), Json::String(since.clone()));
    }
    if !args.skip_lanes.is_empty() {
        body.insert(
            "skipLanes".into(),
            Json::Array(args.skip_lanes.iter().cloned().map(Json::String).collect()),
        );
    }
    if let Some(max_pages) = args.max_pages {
        body.insert("maxPages".into(), Json::from(max_pages));
    }
    Json::Object(body)
}

fn is_lane_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_LANE_ID_BYTES
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Per-link minimum: a window can only vouch for changes every page saw.
/// Ported from `lowestWatermark` in `apps/web/src/lib/queries/calendar/graphql/range.ts`.
pub fn lowest_watermark<'a>(
    pages: impl IntoIterator<Item = &'a [CalendarLinkWatermark]>,
) -> Vec<CalendarLinkWatermark> {
    let mut lowest = BTreeMap::<&str, i64>::new();
    for page in pages {
        for link in page {
            lowest
                .entry(link.link_id.as_str())
                .and_modify(|seq| *seq = (*seq).min(link.seq))
                .or_insert(link.seq);
        }
    }
    lowest
        .into_iter()
        .map(|(link_id, seq)| CalendarLinkWatermark {
            link_id: link_id.to_owned(),
            seq,
        })
        .collect()
}

/// Items of one page at the paging path the server follows.
pub(crate) fn page_items(data: &Json, paging: SyncPaging) -> Option<&Vec<Json>> {
    let user = data.get("user")?;
    match paging {
        SyncPaging::Soup => user.get("soup")?.get("items")?.as_array(),
        SyncPaging::Calendar => user.get("calendarOccurrences")?.get("nodes")?.as_array(),
    }
}

/// The normalized key of each item (`__typename:id`).
pub(crate) fn item_keys(items: &[Json]) -> Result<Vec<EntityKey<'static>>, SyncStreamError> {
    items
        .iter()
        .map(|item| {
            let typename = item.get("__typename").and_then(Json::as_str);
            let id = item.get("id").and_then(Json::as_str);
            match (typename, id) {
                (Some(typename), Some(id)) if !typename.is_empty() && !id.is_empty() => {
                    Ok(EntityKey::entity(typename, &[id]))
                }
                _ => Err(SyncStreamError::Stream(
                    "page item lacks __typename or id".to_owned(),
                )),
            }
        })
        .collect()
}

/// The page's calendar watermark (`data.user.calendarOccurrences.watermark`).
pub(crate) fn page_watermark(data: &Json) -> Result<Vec<CalendarLinkWatermark>, SyncStreamError> {
    let Some(watermark) = data
        .get("user")
        .and_then(|user| user.get("calendarOccurrences"))
        .and_then(|occurrences| occurrences.get("watermark"))
    else {
        return Ok(Vec::new());
    };
    serde_json::from_value(watermark.clone())
        .map_err(|error| SyncStreamError::Stream(format!("invalid calendar watermark: {error}")))
}
