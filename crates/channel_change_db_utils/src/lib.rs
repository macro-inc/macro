#![deny(missing_docs)]

//! Table ownership for per-channel change counters and their append-only log.
//! Callers own authorization, domain projections, retention policy and commits.

mod append;
mod prune;
mod read;

#[cfg(test)]
mod test;

pub use append::{append_activities_in, append_in};
pub use prune::prune_in;
pub use read::{current_seq, read_log};
use uuid::Uuid;

/// The target of one committed change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// A message or its thread/reactions changed.
    Message(Uuid),
    /// An activity shown in a channel timeline was recorded.
    Activity(Uuid),
    /// Bulk history replacement invalidated incremental client state.
    Reset,
}

/// The position allocated to an activity by a batch append.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivitySequence {
    /// Stable activity identity supplied by the caller.
    pub activity_id: Uuid,
    /// Committed channel position, once the caller commits.
    pub seq: i64,
}

/// One stored log row, without a domain-specific projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogRow {
    /// Position within its channel, starting at one.
    pub seq: i64,
    /// Stored discriminator: 1 message, 2 activity, 3 reset.
    pub kind: i16,
    /// Message identity for message changes.
    pub message_id: Option<Uuid>,
    /// Activity identity for activity changes.
    pub activity_id: Option<Uuid>,
}

/// A channel counter, retained floor and bounded rows read in one snapshot.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Log {
    /// Last committed sequence, or zero before the first append.
    pub counter: i64,
    /// Highest pruned sequence, inferred from the first retained row.
    pub floor: i64,
    /// Selected rows in ascending sequence order.
    pub rows: Vec<LogRow>,
}
