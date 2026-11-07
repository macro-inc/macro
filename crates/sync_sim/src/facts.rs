//! Facts are immutable inputs to invariant queries, including deliberately failed runs.
use crate::*;
use doc_sync_core::{SessionId, WalOwner, WalSeq};
use serde::Serialize;
use std::collections::BTreeMap;

/// Semantic comment completion independent of transport retries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum CommentResult {
    /// The server durably accepted it.
    Accepted,
    /// Policy refused it.
    Refused,
    /// No acknowledgment was observed.
    NotAcked,
}

/// One observed fact at a virtual instant.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    /// Monotonic event time.
    pub at: Millis,
    /// Observed fact, never a projected expectation.
    pub fact: Fact,
}
/// Semantic observations at client, transport, storage and server boundaries.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Fact {
    /// Partition state, so expiry queries can locate the precise virtual interval.
    Partition {
        /// Affected client.
        client: ClientName,
        /// Whether black-holed.
        partitioned: bool,
    },
    /// Comment request facts supplied by the future editor adapter.
    CommentSent {
        /// Writer.
        client: ClientName,
        /// Request correlation.
        request: u32,
        /// Comment identity.
        mark_id: String,
        /// Wire request.
        update: String,
        /// Created ranges.
        spans: Vec<IdSpan>,
    },
    /// Actual comment completion; not inferred from convergence.
    CommentReplied {
        /// Writer.
        client: ClientName,
        /// Request correlation.
        request: u32,
        /// Core completion.
        reply: CommentResult,
    },
    /// Operations removed by real collaborative undo, when the editor adapter is available.
    UndoApplied {
        /// Undoing client.
        client: ClientName,
        /// Actual removed IDs.
        removed: Vec<IdSpan>,
    },
    /// Operations in the deterministic server seed, before any client exists.
    ServerSeed {
        /// Document.
        doc: DocIx,
        /// Initial peer counters.
        vv: Vv,
    },
    /// A fresh session/peer exists.
    Opened {
        /// Script name.
        client: ClientName,
        /// Profile.
        profile: ProfileName,
        /// Document.
        doc: DocIx,
        /// Owner.
        session: SessionId,
        /// New peer.
        peer: u64,
        /// User.
        user: String,
        /// Grant.
        access: Access,
        /// Lifecycle.
        kind: ClientKind,
    },
    /// Every peer taken by a core, including reset/probe allocations.
    PeerAssigned {
        /// Client.
        client: ClientName,
        /// Peer.
        peer: u64,
        /// Core-assigned purpose.
        purpose: String,
    },
    /// One script edit and the operations it created.
    LocalOp {
        /// Client.
        client: ClientName,
        /// Operation.
        op: AbstractOp,
        /// New spans.
        spans: Vec<IdSpan>,
    },
    /// Own-peer operations created by any cause, not only script edits.
    LocalCommit {
        /// Client.
        client: ClientName,
        /// Created operations.
        spans: Vec<IdSpan>,
    },
    /// The op could not apply in the current surface state.
    OpSkipped {
        /// Client.
        client: ClientName,
        /// Explanation.
        reason: String,
    },
    /// A browser write was issued (before durability).
    WalAppendIssued {
        /// Client.
        client: ClientName,
        /// Profile.
        profile: ProfileName,
        /// Owner.
        session: SessionId,
        /// Sequence.
        seq: WalSeq,
        /// Update ranges.
        spans: Vec<IdSpan>,
        /// Chatter-origin bytes.
        foreign: bool,
    },
    /// Browser durable completion.
    WalDurable {
        /// Profile.
        profile: ProfileName,
        /// Owner.
        session: SessionId,
        /// Sequence.
        seq: WalSeq,
    },
    /// Power loss revoked a prior durability observation.
    WalWriteLost {
        /// Profile.
        profile: ProfileName,
        /// Owner.
        session: SessionId,
        /// Sequence.
        seq: WalSeq,
    },
    /// Conditional atomic adoption committed; map joins new rows to originals.
    WalAdopted {
        /// Profile.
        profile: ProfileName,
        /// Previous owner.
        from: WalOwner,
        /// New owner.
        to: SessionId,
        /// Committed renumbering.
        map: Vec<(WalSeq, WalSeq)>,
    },
    /// TTL discarded durable rows.
    WalExpired {
        /// Profile.
        profile: ProfileName,
        /// Owner.
        owner: WalOwner,
        /// Removed sequences.
        seqs: Vec<WalSeq>,
    },
    /// A row became excluded from pushing.
    RowsParked {
        /// Client.
        client: ClientName,
        /// Sequence and reason.
        rows: Vec<(WalSeq, String)>,
    },
    /// The actual peer update was sent.
    PushSent {
        /// Client.
        client: ClientName,
        /// Wire request ID.
        update: String,
        /// Durable rows represented.
        rows: Vec<(WalOwner, WalSeq)>,
        /// Actual exported ranges.
        spans: Vec<IdSpan>,
        /// Foreign byte count.
        foreign_bytes: u64,
        /// Own byte count.
        own_bytes: u64,
    },
    /// A successfully imported server update.
    ServerApplied {
        /// Wire request.
        update: String,
        /// Imported ranges.
        spans: Vec<IdSpan>,
        /// Missing dependencies remain.
        pending: bool,
    },
    /// Actual durable peer directory after a callback, for mapping-success proofs.
    DirectoryState {
        /// Document.
        doc: DocIx,
        /// Callback.
        callback: u64,
        /// Peers with a stored attribution row.
        mapped: Vec<u64>,
    },
    /// The pending-operation write reached durable storage.
    ServerDurable {
        /// Wire request.
        update: String,
        /// Callback owning the write.
        callback: u64,
    },
    /// Actual native output-gate proof for every released binary/text send.
    GateReleased {
        /// Document.
        doc: DocIx,
        /// Callback releasing output.
        callback: u64,
        /// Generation required by the send.
        required: u64,
        /// Generation already durable.
        confirmed: u64,
    },
    /// Output gate released an acknowledgment.
    AckSent {
        /// Wire request.
        update: String,
        /// Callback owning the send.
        callback: u64,
    },
    /// Client received the durable acknowledgment.
    AckReceived {
        /// Client.
        client: ClientName,
        /// Wire request.
        update: String,
    },
    /// Gate/permission policy refused the update.
    UpdateRefused {
        /// Wire request.
        update: String,
        /// Refused ranges.
        spans: Vec<IdSpan>,
    },
    /// Successful pending-operation writes, distinct from attempted port calls.
    PendingStored {
        /// Document.
        doc: DocIx,
        /// Callback that completed the write.
        callback: u64,
        /// Exact pending-operation key.
        key: String,
        /// Stored operation ranges.
        spans: Vec<IdSpan>,
        /// Output gate write generation.
        generation: u64,
    },
    /// Real document import result.
    Imported {
        /// Client.
        client: ClientName,
        /// Input path.
        origin: String,
        /// Whether dependencies remain.
        pending: bool,
        /// Error details, if any.
        error: Option<String>,
    },
    /// Core telemetry, retained verbatim with ordered attributes.
    Telemetry {
        /// Client.
        client: ClientName,
        /// Event name.
        name: String,
        /// Ordered scalar attributes.
        attributes: BTreeMap<String, serde_json::Value>,
    },
    /// A public core status transition.
    Status {
        /// Client.
        client: ClientName,
        /// Public diagnostic representation.
        #[serde(serialize_with = "serialize_status")]
        status: doc_sync_core::SyncStatus,
    },
    /// Current effective client grant.
    AccessChanged {
        /// Client.
        client: ClientName,
        /// Grant.
        access: Access,
    },
    /// Visible remote presence values, ordered by key.
    PresenceChanged {
        /// Client.
        client: ClientName,
        /// Visible selections.
        remote: BTreeMap<String, serde_json::Value>,
    },
    /// Physical frame delivery/loss.
    Frame {
        /// Client endpoint.
        client: ClientName,
        /// Connection generation.
        connection: u32,
        /// Direction.
        direction: Direction,
        /// Message kind.
        kind: FrameKind,
        /// Actual byte count.
        bytes: u32,
        /// Total fragments when known.
        frames: u16,
        /// Delivered/dropped/corrupted/lost.
        fate: String,
    },
    /// A tab lost all volatile state.
    Crashed {
        /// Client.
        client: ClientName,
    },
    /// Browser process lost all volatile state.
    ProfileCrashed {
        /// Profile.
        profile: ProfileName,
    },
    /// Input suspension began.
    Frozen {
        /// Client.
        client: ClientName,
    },
    /// Queued inputs resumed.
    Thawed {
        /// Client.
        client: ClientName,
    },
    /// A graceful stop actually completed.
    Closed {
        /// Client.
        client: ClientName,
    },
    /// Real core request result.
    Reply {
        /// Client.
        client: ClientName,
        /// Correlation.
        request: u32,
        /// Diagnostic result.
        reply: String,
    },
    /// Client first became idle during settling.
    ClientSettled {
        /// Client.
        client: ClientName,
        /// Session.
        session: SessionId,
    },
    /// Healing and heartbeat hold completed.
    Settled,
    /// Liveness budget expired.
    SettleTimedOut {
        /// Real core busy reasons.
        busy: BTreeMap<ClientName, String>,
    },
    /// Server lifecycle transition.
    Server {
        /// Operation.
        operation: String,
    },
}
/// Final state of one real client core/document.
#[derive(Clone, Debug, PartialEq)]
pub struct ClientFinal {
    /// Whether a session remains live.
    pub alive: bool,
    /// Terminal connection reason, when closed by the core.
    pub terminal: Option<String>,
    /// Session owner.
    pub session: SessionId,
    /// Browser namespace.
    pub profile: ProfileName,
    /// User owning recovered WAL rows.
    pub user: String,
    /// Document route.
    pub doc: DocIx,
    /// Effective grant.
    pub access: Access,
    /// Tab or AI worker.
    pub kind: ClientKind,
    /// Current writer peer.
    pub peer: u64,
    /// Ordered actual oplog vector.
    pub oplog_vv: Vv,
    /// Actual Loro content.
    pub deep_value: serde_json::Value,
    /// Unacknowledged pushable rows.
    pub wal_undelivered: usize,
    /// Every retained unacknowledged row, including parked rows.
    pub wal_total: usize,
    /// Actual parked rows.
    pub parked: Vec<(WalSeq, String)>,
    /// Public core status.
    pub status: doc_sync_core::SyncStatus,
    /// Durable storage health.
    pub storage_healthy: bool,
    /// Document still awaits dependencies.
    pub pending_import: bool,
    /// Last advertised selection.
    pub selection: Option<u16>,
    /// Peer or fixed AI presence key.
    pub presence_key: String,
    /// Wall-clock offset retained across settle.
    pub skew: i64,
}
/// Freshly loaded durable room state, alongside live room state.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ServerFinal {
    /// Live oplog vector.
    pub oplog_vv: Vv,
    /// Live Loro content.
    pub deep_value: serde_json::Value,
    /// Oplog reconstructed from cloned durable storage with a fresh Room.
    pub persisted_vv: Vv,
    /// Missing dependencies remain.
    pub pending_import: bool,
    /// Real active_peers(false) output.
    pub active_peers_without_ai: Vec<u64>,
}
/// Immutable end-state images.
#[derive(Clone, Debug, PartialEq)]
pub struct Finals {
    /// All named clients, including crashed and terminal ones.
    pub clients: BTreeMap<ClientName, ClientFinal>,
    /// Independent documents.
    pub servers: BTreeMap<DocIx, ServerFinal>,
    /// Durable profile stores.
    pub profiles: BTreeMap<ProfileName, crate::storage::StoreImage>,
    /// Presence at first quiescence, before expiry during the heartbeat hold.
    pub presence: Option<BTreeMap<ClientName, BTreeMap<String, serde_json::Value>>>,
}
/// Runtime work counters; derived from observed transitions.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct RunStats {
    /// Scheduled events processed.
    pub events: u64,
    /// Real client handle calls.
    pub handles: u64,
    /// Core rebases started.
    pub rebases: u64,
    /// Physical frames.
    pub frames: u64,
    /// Completed adopted rows.
    pub adopted_rows: u64,
}
/// Callback-tagged original server port evidence.
#[derive(Clone, Debug)]
pub struct ServerPort {
    /// World document.
    pub doc: DocIx,
    /// Callback identity.
    pub callback: u64,
    /// Original core capability effect.
    pub effect: sync_server_sim::ports::Effect,
}
/// Completed run, including failures and the quiet observation window.
#[derive(Clone)]
pub struct Outcome {
    /// Reproduction configuration; scripts may override network/storage profiles.
    pub config: SimConfig,
    /// Reproduction seed.
    pub seed: u64,
    /// Literal reproduction script.
    pub script: Vec<Step>,
    /// Raw semantic observations in actual processing order.
    pub events: Vec<Event>,
    /// Original ordered room capability log.
    pub server_ports: Vec<ServerPort>,
    /// State immediately after the script.
    pub finals: Finals,
    /// Events observed during the final quiet window.
    pub quiet_events: Vec<Event>,
    /// State after the additional quiet window.
    pub finals_after_quiet: Finals,
    /// Canonical postcard encoding of semantic observations.
    pub event_bytes: Vec<u8>,
    /// xxh3_64 of canonical observations, port evidence and final state.
    pub trace_hash: u64,
    /// Work counters.
    pub stats: RunStats,
    /// Per-step checks and execution failures; run continues for diagnosis.
    pub per_step_failures: Vec<Failure>,
    /// Editor-only integration still unavailable on this stack.
    pub pending_adapters: Vec<String>,
}

fn serialize_status<S: serde::Serializer>(
    status: &doc_sync_core::SyncStatus,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&format!("{status:?}"))
}
