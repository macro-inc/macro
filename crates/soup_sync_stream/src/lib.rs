//! Streamed cache sync for Soup GraphQL.
//!
//! `POST /soup/graphql/stream` runs a list of client-supplied Soup or calendar
//! queries ("lanes") page by page, following each page's cursor, and writes
//! every page as one NDJSON line. The wire format is the shared contract in
//! `docs/architecture/streamed-cache-sync.md`.
//!
//! This crate holds the transport-free part: request validation
//! ([`SyncPlan::from_json`]), the lane loop over a [`PageExecutor`]
//! ([`frames`], [`ndjson_stream`]), the frames and their encoding
//! ([`Frame`]), the per-user single-stream guard ([`ActiveStreams`]), and the
//! page slots streams take turns on ([`PageTurns`]).
//! The service mounting the route supplies authentication and the executor.
#![deny(missing_docs)]

mod active;
mod frame;
mod request;
mod runner;
mod turns;

pub use active::{ActiveStreamGuard, ActiveStreams};
pub use frame::{EndReason, Frame, LaneDoneReason};
pub use request::{InvalidLaneId, LaneId, MAX_LANES, RequestError, SyncPlan};
pub use runner::{PageExecutor, frames, ndjson_stream};
pub use turns::{PageTurn, PageTurns, StreamTurns};
