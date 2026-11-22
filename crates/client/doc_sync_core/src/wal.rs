use crate::*;
use std::{collections::VecDeque, sync::Arc};

/// In-memory WAL bookkeeping, ordered by sequence.
#[derive(Debug)]
pub struct Wal {
    /// Own, adopted, and foreign rows in sequence order.
    pub entries: VecDeque<WalEntry>, // own, adopted and foreign rows, ascending seq
    /// Longest acknowledged sequence prefix.
    pub delivered_through: Option<WalSeq>,
    /// Next sequence to allocate.
    pub next_seq: WalSeq,
    /// Version vector at the last exported local window.
    pub logged_vv: loro::VersionVector, // oplog vv at the last export
    /// Coalesced append deadline, when set.
    pub append_due: Option<Millis>, // coalesce deadline
    /// Current persistence health.
    pub health: StorageHealth, // Ok | Failed { since: Millis }
}

/// In-memory delivery and persistence state for a WAL row.
#[derive(Debug)]
pub struct WalEntry {
    /// Sequence number within one owner’s WAL.
    pub seq: WalSeq,
    /// Wall-clock timestamp when the row was created.
    pub created_at: UnixMillis,
    /// Whether the bytes came from another session’s chatter.
    pub foreign: bool,
    /// Opaque serialized document bytes.
    pub bytes: Arc<[u8]>,
    /// Durability state of this row.
    pub state: EntryState,
    /// Consecutive attempts lacking an acknowledgement.
    pub not_acked: u8,
    /// vv of the own peer before this entry's export (W-2 superset rebuild).
    pub vv_before: loro::VersionVector,
    /// Reason this row is excluded from pushes, when parked.
    pub park: Option<ParkReason>,
    /// Rows a superset row replaced (W-2); pushed as that one row.
    pub superseded: bool,
}

/// Whether the current row has reached durable storage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryState {
    /// Awaiting a correlated storage completion.
    Writing(StorageOpId),
    /// The row is durably stored.
    Logged,
    /// The store refused the append. The entry is held in memory and re-appended on the
    /// next trigger (generalizes forms' `FormWAL.unlogged`).
    Unlogged {
        /// Number of refused append attempts.
        failures: u8,
    },
}

/// Reason an entry is retained without being pushed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParkReason {
    /// Write authorization is absent.
    ReadOnly,
    /// A locally proven invalid row is retained in quarantine.
    Poison,
    /// A sequence gap prevents safe delivery.
    Gap,
    /// The row requires a fresh shallow base.
    NeedsRebase,
}
/// Storage health for the current session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageHealth {
    /// Storage is healthy.
    Ok,
    /// The attempt failed.
    Failed {
        /// Monotonic instant when storage first failed.
        since: Millis,
    },
}
