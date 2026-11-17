//! Streamed cache sync: plan types, NDJSON frame decoding, and per-run progress.
//!
//! A host (browser worker, native plugin) opens one HTTP stream built from a
//! [`SyncStartArgs`] plan and feeds the response bytes to a [`SyncRun`]. The
//! run decodes complete lines into frames; the host applies them one at a time
//! with [`crate::engine::Engine::sync_apply_next`], each application being one
//! engine write. The run itself never touches the network or a clock: hosts
//! supply both. Contract: `apps/web/src/lib/graphql-cache/sync-protocol.ts`.

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

/// Maximum lanes in one request (the server rejects more).
pub const MAX_SYNC_LANES: usize = 32;
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

/// One lane of a sync plan.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLanePlan {
    /// `[a-z0-9-]{1,64}`; also the key of the lane's saved state.
    pub id: String,
    /// Server-safe query text.
    pub query: String,
    /// Selected operation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_name: Option<String>,
    /// Variables for the lane's first page.
    pub variables: Map<String, Json>,
    /// How the server follows pages.
    pub paging: SyncPaging,
    /// Stop after at least this many items. Invalid on membership lanes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_items: Option<u64>,
    /// What the cache does with the lane's pages.
    pub kind: SyncLaneKind,
    /// ISO time this lane's pass started; stored with the first page.
    pub pass_started_at: String,
    /// Opaque description stored when the lane completes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<Json>,
}

/// A run request: the stream to open and the lanes it carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStartArgs {
    /// Absolute stream URL.
    pub url: String,
    /// Extra request headers (mail cache profile, bearer token).
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Lanes in priority order.
    pub lanes: Vec<SyncLanePlan>,
    /// End the stream after this many pages (0 sends none); the next run resumes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_pages: Option<u64>,
}

/// Saved per-lane state, read from the cache database.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLaneState {
    /// Lane id.
    pub id: String,
    /// Resume point of an unfinished pass; `None` when none is in progress.
    pub next_variables: Option<Map<String, Json>>,
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
    /// `coverage` of the last completed pass.
    #[serde(default)]
    pub coverage: Json,
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

    /// Starts counting a new pass when the plan names a different one.
    pub(crate) fn begin_pass(&mut self, pass_started_at: &str) {
        if self.state.pass_started_at.as_deref() != Some(pass_started_at) {
            self.state.pass_started_at = Some(pass_started_at.to_owned());
            self.state.pages = 0;
            self.state.items = 0;
            self.state.next_variables = None;
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
#[expect(
    clippy::large_enum_variant,
    reason = "nearly every frame is a page, and frames are handled one at a time"
)]
pub enum SyncFrame {
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
        /// What the lane runs next; `None` when the lane is done.
        next_variables: Option<Map<String, Json>>,
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
    /// Lanes in plan order.
    pub lanes: Vec<SyncLaneRunSummary>,
}

/// Failures detected without touching the cache.
#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum SyncStreamError {
    /// The plan breaks the contract.
    #[error("invalid sync plan: {0}")]
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

/// One run: the plan, the decoder, decoded frames not yet applied, and progress.
#[derive(Debug)]
pub struct SyncRun {
    pub(crate) lanes: Vec<SyncLanePlan>,
    /// Each lane's parsed operation, parsed once per run (some lane queries
    /// are tens of kilobytes and lanes run thousands of pages).
    pub(crate) operations: BTreeMap<String, std::sync::Arc<crate::document::Operation>>,
    max_pages: Option<u64>,
    decoder: NdjsonDecoder,
    pub(crate) pending: VecDeque<SyncFrame>,
    pub(crate) progress: BTreeMap<String, LaneProgress>,
    bytes: u64,
    started_at_ms: f64,
    pub(crate) end: Option<SyncEndReason>,
}

impl SyncRun {
    /// Validates a plan and starts a run at `started_at_ms` (the host's
    /// monotonic clock, the same one later passed to [`Self::summary`]).
    pub fn new(args: &SyncStartArgs, started_at_ms: f64) -> Result<Self, SyncStreamError> {
        let plan = |message: String| Err(SyncStreamError::Plan(message));
        // An empty plan or `maxPages: 0` is valid: the server answers `end` at once.
        if args.lanes.len() > MAX_SYNC_LANES {
            return plan(format!("expected at most {MAX_SYNC_LANES} lanes"));
        }
        let ids = args
            .lanes
            .iter()
            .map(|lane| lane.id.as_str())
            .collect::<BTreeSet<_>>();
        if ids.len() != args.lanes.len() {
            return plan("lane ids must be unique".to_owned());
        }
        for lane in &args.lanes {
            if !is_lane_id(&lane.id) {
                return plan(format!("lane id `{}` is not [a-z0-9-]{{1,64}}", lane.id));
            }
            if lane.max_items == Some(0) {
                return plan(format!("lane `{}` maxItems must be positive", lane.id));
            }
            match &lane.kind {
                SyncLaneKind::Membership { scopes } => {
                    if lane.max_items.is_some() {
                        return plan(format!("membership lane `{}` cannot set maxItems", lane.id));
                    }
                    if scopes.is_empty() || scopes.iter().any(|scope| !is_lane_id(scope)) {
                        return plan(format!(
                            "membership lane `{}` needs lane-id scopes",
                            lane.id
                        ));
                    }
                }
                SyncLaneKind::Calendar { coverage } => {
                    if lane.paging != SyncPaging::Calendar {
                        return plan(format!("calendar lane `{}` needs calendar paging", lane.id));
                    }
                    if coverage.iter().any(|span| span.start > span.end) {
                        return plan(format!("calendar lane `{}` has an invalid span", lane.id));
                    }
                }
                SyncLaneKind::Hydrate => {}
            }
        }
        Ok(Self {
            progress: args
                .lanes
                .iter()
                .map(|lane| (lane.id.clone(), LaneProgress::default()))
                .collect(),
            lanes: args.lanes.clone(),
            operations: BTreeMap::new(),
            max_pages: args.max_pages,
            decoder: NdjsonDecoder::default(),
            pending: VecDeque::new(),
            bytes: 0,
            started_at_ms,
            end: None,
        })
    }

    /// The JSON request body the host sends (section 1 of the contract).
    pub fn request_body(&self) -> Json {
        let lanes = self
            .lanes
            .iter()
            .map(|lane| {
                let mut body = Map::new();
                body.insert("id".into(), Json::String(lane.id.clone()));
                body.insert("query".into(), Json::String(lane.query.clone()));
                if let Some(name) = &lane.operation_name {
                    body.insert("operationName".into(), Json::String(name.clone()));
                }
                body.insert("variables".into(), Json::Object(lane.variables.clone()));
                body.insert(
                    "paging".into(),
                    serde_json::to_value(lane.paging).unwrap_or(Json::Null),
                );
                if let Some(max_items) = lane.max_items {
                    body.insert("maxItems".into(), Json::from(max_items));
                }
                Json::Object(body)
            })
            .collect();
        let mut body = Map::new();
        body.insert("protocol".into(), Json::from(SYNC_PROTOCOL));
        body.insert("lanes".into(), Json::Array(lanes));
        if let Some(max_pages) = self.max_pages {
            body.insert("maxPages".into(), Json::from(max_pages));
        }
        Json::Object(body)
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
            SyncFrame::Page { lane, .. } | SyncFrame::LaneError { lane, .. } => Some((lane, false)),
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

    pub(crate) fn lane(&self, id: &str) -> Result<&SyncLanePlan, SyncStreamError> {
        self.lanes
            .iter()
            .find(|lane| lane.id == id)
            .ok_or_else(|| SyncStreamError::Stream(format!("frame names unknown lane `{id}`")))
    }
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
