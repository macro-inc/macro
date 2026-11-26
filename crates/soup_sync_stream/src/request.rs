//! The request body of the sync stream: the pass to run and the client's
//! saved lane state, from which the server plans the stream's lanes.

#[cfg(test)]
mod test;

use crate::calendar::{CalendarSpan, MaterializedRange};
use crate::catalog::Pass;
use crate::lane::{LaneError, LaneId, LanePlan};
use crate::plan::plan_lanes;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    ops::RangeInclusive,
};

/// Sync protocol versions this server speaks. A version names what the
/// client's cache engine sends and decodes: the request, the lines, their
/// fields and what they mean. Raise the upper end, and ship that server,
/// before any engine sends the new version; raise the lower end only once no
/// supported client sends the old one.
pub const PROTOCOL_VERSIONS: RangeInclusive<u8> = 1..=1;
/// Most lanes one stream runs; calendar windows take what the pass's other
/// lanes leave.
pub const MAX_LANES: usize = 32;
/// Most saved lanes a request may carry.
pub const MAX_SAVED_LANES: usize = 256;
/// Most calendar coverage spans a request may carry.
pub const MAX_COVERAGE_SPANS: usize = 10_000;
/// Most lane query documents a request may carry.
pub const MAX_LANE_QUERIES: usize = 64;
/// Most bytes a request's lane query documents may hold together.
pub const MAX_LANE_QUERY_BYTES: usize = 512 * 1024;

/// The body's protocol, read before anything else in it, so a body of another
/// protocol's shape is refused for its protocol rather than as malformed.
#[derive(Debug, Deserialize)]
struct ProtocolField {
    protocol: Option<u8>,
}

/// The JSON request body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRequest {
    pub(crate) pass: Pass,
    /// The client's saved state of every lane that has run against its cache.
    #[serde(default)]
    pub(crate) lanes: Vec<SavedLane>,
    /// Plan calendar windows; absent while the client reads calendars elsewhere.
    pub(crate) calendar: Option<CalendarRequest>,
    /// Leave out lanes that completed at or after this time (the client's
    /// clock, as `completedAt`): they are current for this run.
    pub(crate) completed_since: Option<DateTime<Utc>>,
    /// Soup lanes to leave out of this stream.
    #[serde(default)]
    pub(crate) skip_lanes: Vec<LaneId>,
    /// End the stream after this many pages.
    pub(crate) max_pages: Option<u32>,
    /// The client's document for each lane operation it runs, by operation
    /// name: its own field selection, which its cache schema knows. A lane
    /// whose operation is missing is left out.
    #[serde(default)]
    pub(crate) queries: HashMap<String, String>,
}

/// One lane's saved state in the client's cache.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedLane {
    pub(crate) id: LaneId,
    /// The `resume` of the lane's last written page while its pass is unfinished.
    pub(crate) resume: Option<Value>,
    /// When the lane's last completed pass started.
    pub(crate) watermark: Option<DateTime<Utc>>,
    /// When the lane's last pass completed, on the client's clock.
    pub(crate) completed_at: Option<DateTime<Utc>>,
}

/// What calendar windows are planned from.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarRequest {
    /// The client's IANA time zone: its months and local dates. A name this
    /// server does not know plans no windows: the client's calendar then reads
    /// its months from the network, and the rest of the sync runs.
    pub(crate) time_zone: String,
    /// What the client's cache already holds.
    #[serde(default)]
    pub(crate) coverage: Vec<CalendarSpan>,
}

/// Why a request body was rejected: HTTP 426 for
/// [`RequestError::UnsupportedProtocol`] and [`RequestError::NoLaneQueries`],
/// 500 for [`RequestError::Catalog`], 400 for the rest.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The body names no protocol, or one outside [`PROTOCOL_VERSIONS`]: the
    /// client's cache engine is too old or too new for this server.
    #[error(
        "sync protocol {} is not supported; this server speaks {} to {}",
        protocol_name(*.0),
        PROTOCOL_VERSIONS.start(),
        PROTOCOL_VERSIONS.end()
    )]
    UnsupportedProtocol(Option<u8>),
    /// The body is not JSON of the request shape.
    #[error("invalid request body: {0}")]
    Body(#[from] serde_json::Error),
    /// More than [`MAX_SAVED_LANES`] saved lanes.
    #[error("a request carries at most {MAX_SAVED_LANES} saved lanes, got {0}")]
    TooManySavedLanes(usize),
    /// Two saved lanes share an id.
    #[error("saved lane `{0}` appears more than once")]
    DuplicateLane(LaneId),
    /// More than [`MAX_SAVED_LANES`] lanes to skip.
    #[error("a request skips at most {MAX_SAVED_LANES} lanes, got {0}")]
    TooManySkippedLanes(usize),
    /// More than [`MAX_COVERAGE_SPANS`] calendar coverage spans.
    #[error("a request carries at most {MAX_COVERAGE_SPANS} coverage spans, got {0}")]
    TooManyCoverageSpans(usize),
    /// No lane documents: a cache engine from before clients sent them, which
    /// can run no lane and pages instead (HTTP 426, like
    /// [`RequestError::UnsupportedProtocol`]).
    #[error("the request sends no lane queries; this server runs only the client's lane documents")]
    NoLaneQueries,
    /// More than [`MAX_LANE_QUERIES`] lane query documents.
    #[error("a request carries at most {MAX_LANE_QUERIES} lane queries, got {0}")]
    TooManyLaneQueries(usize),
    /// Lane query documents over [`MAX_LANE_QUERY_BYTES`] together.
    #[error("a request's lane queries hold at most {MAX_LANE_QUERY_BYTES} bytes, got {0}")]
    LaneQueriesTooLarge(usize),
    /// A lane query document the client sent does not run its lane.
    #[error("sync lane `{lane}` cannot run the query sent for it: {source}")]
    LaneQuery {
        /// The lane.
        lane: String,
        /// Why the query does not run it.
        #[source]
        source: LaneError,
    },
    /// A lane of the server's own catalog does not build: a server bug.
    #[error("sync lane `{lane}` does not build: {source}")]
    Catalog {
        /// The lane.
        lane: String,
        /// Why it does not build.
        #[source]
        source: LaneError,
    },
}

/// A planned stream: the protocol, the pass, the lanes to run, in order, and
/// the page budget.
#[derive(Debug)]
pub struct SyncPlan {
    pub(crate) protocol: u8,
    pub(crate) pass: Pass,
    /// How many saved lanes the client sent.
    pub(crate) saved_lanes: usize,
    pub(crate) lanes: Vec<LanePlan>,
    pub(crate) max_pages: Option<u32>,
}

impl SyncPlan {
    /// Parses a request body, its protocol first, and plans its lanes at `now`,
    /// calendar windows inside the `materialized` range.
    pub fn from_json(
        body: &[u8],
        now: DateTime<Utc>,
        materialized: MaterializedRange,
    ) -> Result<Self, RequestError> {
        let ProtocolField { protocol } = serde_json::from_slice(body)?;
        let protocol = protocol
            .filter(|version| PROTOCOL_VERSIONS.contains(version))
            .ok_or(RequestError::UnsupportedProtocol(protocol))?;
        let request: SyncRequest = serde_json::from_slice(body)?;
        if request.lanes.len() > MAX_SAVED_LANES {
            return Err(RequestError::TooManySavedLanes(request.lanes.len()));
        }
        if request.skip_lanes.len() > MAX_SAVED_LANES {
            return Err(RequestError::TooManySkippedLanes(request.skip_lanes.len()));
        }
        let spans = request
            .calendar
            .as_ref()
            .map_or(0, |calendar| calendar.coverage.len());
        if spans > MAX_COVERAGE_SPANS {
            return Err(RequestError::TooManyCoverageSpans(spans));
        }
        if request.queries.is_empty() {
            return Err(RequestError::NoLaneQueries);
        }
        if request.queries.len() > MAX_LANE_QUERIES {
            return Err(RequestError::TooManyLaneQueries(request.queries.len()));
        }
        let query_bytes = request
            .queries
            .iter()
            .map(|(operation, query)| operation.len() + query.len())
            .sum::<usize>();
        if query_bytes > MAX_LANE_QUERY_BYTES {
            return Err(RequestError::LaneQueriesTooLarge(query_bytes));
        }
        let mut seen = HashSet::new();
        if let Some(lane) = request.lanes.iter().find(|lane| !seen.insert(&lane.id)) {
            return Err(RequestError::DuplicateLane(lane.id.clone()));
        }
        Ok(Self {
            protocol,
            pass: request.pass,
            saved_lanes: request.lanes.len(),
            lanes: plan_lanes(&request, now, materialized)?,
            max_pages: request.max_pages,
        })
    }

    /// How many lanes the stream runs.
    pub fn lane_count(&self) -> usize {
        self.lanes.len()
    }
}

/// A requested protocol for [`RequestError::UnsupportedProtocol`]'s message.
fn protocol_name(protocol: Option<u8>) -> String {
    protocol.map_or_else(|| "(none)".to_owned(), |version| version.to_string())
}
