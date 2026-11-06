//! One document's sync machine.
//!
//! Owns the replica, the attached peers, and the persistence bookkeeping for
//! a single document. Pure: `handle` is the entire API — feed an [`Input`],
//! get an [`Outcome`]. The invariants that were implicit in the Durable
//! Object (ack only after durable storage, one compaction at a time, initial
//! sync deferred until loaded, evict only when clean) are explicit state here
//! and covered by table-driven tests.
//!
//! This file holds the state; behavior lives in the submodules by lifecycle
//! area: [`session`] (attach/detach), [`frames`] (client messages), [`load`]
//! (store load completions), [`persist`] (persistence completions and
//! requests), [`timers`], with the shared plumbing in [`helpers`].

#[cfg(test)]
mod test;

mod frames;
mod helpers;
mod load;
mod persist;
mod session;
mod timers;

use crate::model::{Capabilities, ClientFrame, ConnId, Input, Outcome, PersistToken, TimerToken};
use crate::replica::Replica;
use std::collections::{BTreeMap, VecDeque};

/// Debounce between an accepted update and the snapshot compaction that folds
/// it in — the Durable Object's 5-second alarm.
pub const PERSIST_DEBOUNCE_MS: u64 = 5_000;

/// How long a peerless, clean document stays resident before asking to be
/// evicted.
pub const IDLE_EVICT_MS: u64 = 60_000;

/// Delay before retrying a failed persistence request.
pub const PERSIST_RETRY_MS: u64 = 1_000;

/// What a scheduled timer means when it fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimerKind {
    /// Compact: persist a snapshot if anything changed.
    PersistDebounce,
    /// Evict if still peerless and clean.
    Idle,
    /// Re-attempt persistence after a failure.
    PersistRetry,
}

/// Where the document is in its life.
enum Phase<R> {
    /// Created, but nothing has attached yet; no load requested.
    Fresh,
    /// [`Effect::Load`] emitted; frames queue until the store answers.
    Loading {
        /// Frames received before the snapshot arrived, replayed in order
        /// once it does.
        queued: Vec<(ConnId, ClientFrame)>,
    },
    /// Live. The replica exists only here, so "apply before load" is
    /// unrepresentable.
    Ready {
        /// The materialized document.
        replica: R,
    },
    /// The store failed to load the document; attaches are refused.
    Broken,
}

/// Per-connection state.
#[derive(Debug, Clone)]
struct Peer {
    capabilities: Capabilities,
    /// CRDT peer ids this connection registered (usually one).
    peer_ids: Vec<u64>,
}

/// One applied-but-not-yet-compacted op.
#[derive(Debug, Clone)]
struct OpEntry {
    seq: u64,
    update: Vec<u8>,
    /// Who authored it — excluded from the post-durability broadcast.
    author: ConnId,
}

/// An update batch acked once `persisted_seq` reaches `through_seq`.
#[derive(Debug, Clone)]
struct PendingAck {
    conn: ConnId,
    id: String,
    through_seq: u64,
}

/// See the module docs.
pub struct DocMachine<R: Replica> {
    phase: Phase<R>,
    peers: BTreeMap<ConnId, Peer>,

    /// Last op sequence assigned. Assigned only *after* a successful apply,
    /// so any op holding a seq is contained in every later snapshot.
    seq: u64,
    /// Ops are durable through here; acks release up to this watermark.
    persisted_seq: u64,
    /// The last durable snapshot covers ops through here. `seq >
    /// snapshot_seq` is the machine's only definition of "dirty".
    snapshot_seq: u64,

    /// Ops not yet covered by a durable snapshot, retained for persist retry
    /// and for the post-durability broadcast. Trimmed when a snapshot commits.
    op_tail: VecDeque<OpEntry>,
    pending_acks: VecDeque<PendingAck>,

    /// At most one op-persist in flight; further ops wait in `op_tail` and go
    /// out when the current request completes.
    inflight_ops: Option<(PersistToken, u64)>,
    /// At most one snapshot-persist in flight.
    inflight_snapshot: Option<(PersistToken, u64)>,

    /// Live timers, so stale [`Input::TimerFired`]s are ignored.
    timers: BTreeMap<TimerToken, TimerKind>,
    persist_timer: Option<TimerToken>,
    idle_timer: Option<TimerToken>,
    retry_timer: Option<TimerToken>,

    next_token: u64,
}

impl<R: Replica> Default for DocMachine<R> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: Replica> DocMachine<R> {
    /// A fresh machine for a document nothing has touched yet.
    pub fn new() -> Self {
        Self {
            phase: Phase::Fresh,
            peers: BTreeMap::new(),
            seq: 0,
            persisted_seq: 0,
            snapshot_seq: 0,
            op_tail: VecDeque::new(),
            pending_acks: VecDeque::new(),
            inflight_ops: None,
            inflight_snapshot: None,
            timers: BTreeMap::new(),
            persist_timer: None,
            idle_timer: None,
            retry_timer: None,
            next_token: 0,
        }
    }

    /// Whether the machine holds live peers or unpersisted work. `false`
    /// means dropping it loses nothing.
    pub fn is_evictable(&self) -> bool {
        self.peers.is_empty()
            && self.seq == self.snapshot_seq
            && self.inflight_ops.is_none()
            && self.inflight_snapshot.is_none()
    }

    /// Feed one input; returns the actions it produced, the lifecycle
    /// transition it observed, and why.
    pub fn handle(&mut self, input: Input) -> Outcome {
        match input {
            Input::PeerAttached { conn, capabilities } => self.on_attached(conn, capabilities),
            Input::PeerDetached { conn } => self.on_detached(conn),
            Input::Frame { conn, frame } => self.on_frame(conn, frame),
            Input::TimerFired { token } => self.on_timer(token),
            Input::Loaded {
                snapshot,
                snapshot_seq,
                ops,
            } => self.on_loaded(snapshot, snapshot_seq, ops),
            Input::LoadFailed { error: _ } => self.on_load_failed(),
            Input::OpsPersisted { token, through_seq } => self.on_ops_persisted(token, through_seq),
            Input::SnapshotPersisted { token } => self.on_snapshot_persisted(token),
            Input::PersistFailed { token } => self.on_persist_failed(token),
        }
    }
}
