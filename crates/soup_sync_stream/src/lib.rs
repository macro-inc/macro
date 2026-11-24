//! Streamed cache sync for Soup GraphQL.
//!
//! `POST /soup/graphql/stream` runs the lanes of a sync pass, Soup and calendar
//! queries the server plans from the client's saved lane state, page by page,
//! following each page's cursor, and writes every page as one NDJSON line. The
//! wire format is the shared contract in
//! `docs/architecture/streamed-cache-sync.md`.
//!
//! This crate holds the transport-free part: request parsing, the protocol
//! version first, and planning ([`SyncPlan::from_json`], [`PROTOCOL_VERSIONS`]),
//! the lane catalog, the lane loop over a [`PageExecutor`] ([`frames`],
//! [`ndjson_stream`]), the frames and their encoding ([`Frame`]), the per-user
//! single-stream guard ([`ActiveStreams`]), and the page slots streams take
//! turns on ([`PageTurns`]). The service mounting the route supplies
//! authentication and the executor.
#![deny(missing_docs)]

mod active;
mod calendar;
mod catalog;
mod frame;
mod lane;
mod plan;
mod request;
mod runner;
mod turns;

pub use active::{ActiveStreamGuard, ActiveStreams};
pub use calendar::{CalendarSpan, MaterializedRange, SpanKind};
pub use catalog::{LANE_QUERIES, LaneQuery, Pass};
pub use frame::{EndReason, Frame, LaneDoneReason};
pub use lane::{InvalidLaneId, LaneError, LaneId, LaneKind, Paging};
pub use request::{
    MAX_COVERAGE_SPANS, MAX_LANES, MAX_SAVED_LANES, PROTOCOL_VERSIONS, RequestError, SyncPlan,
};
pub use runner::{PageExecutor, frames, ndjson_stream};
pub use turns::{PageTurn, PageTurns, StreamTurns};
