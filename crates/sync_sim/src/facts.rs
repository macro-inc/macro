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
/// Telemetry instruction phase, preserving start versus scheduled-event evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum TelemetryPhase {
    /// Span creation.
    Start,
    /// Point event.
    Event,
    /// Span completion.
    End,
}
/// Semantic observations at client, transport, storage and server boundaries.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Fact {
    /// Actual child-reported local peer growth; never inferred from a requested edit.
    ExternalCommit {
        /// Foreign peer name.
        client: ClientName,
        /// Document route.
        doc: DocIx,
        /// Newly created peer operation ranges.
        spans: Vec<IdSpan>,
    },
    /// Exact row actually damaged by an injected storage fault, before any adoption.
    WalCorrupted {
        /// Durable storage namespace.
        profile: ProfileName,
        /// Document identity.
        doc: doc_sync_core::SyncDocId,
        /// Owner at corruption time.
        owner: WalOwner,
        /// Sequence at corruption time.
        seq: WalSeq,
    },
    /// An actual token-fetch effect, before its scheduled completion.
    TokenRequested {
        /// Requesting client.
        client: ClientName,
        /// Requesting session.
        session: SessionId,
        /// Core attempt identity.
        attempt: u32,
    },
    /// An actual applied client wall-clock offset, including its signed direction.
    ClockSkew {
        /// Client whose injected clock changed.
        client: ClientName,
        /// Offset relative to the world's fixed wall origin.
        wall_offset_ms: i64,
    },
    /// Partition state, so expiry queries can locate the precise virtual interval.
    Partition {
        /// Affected client.
        client: ClientName,
        /// Whether black-holed.
        partitioned: bool,
    },
    /// A real client socket-close instruction, including protocol-error closes.
    SocketClose {
        /// Client.
        client: ClientName,
        /// Socket generation.
        connection: u32,
        /// Wire close status code.
        code: u16,
        /// Actual core close cause (independent of its wire status mapping).
        reason: String,
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
    /// Operations created by the injected-time AI fork used for an atomic server update.
    ServerCommit {
        /// Destination document.
        doc: DocIx,
        /// AI-range writing peer supplied by the world's RNG.
        peer: u64,
        /// Actual newly created ranges.
        spans: Vec<IdSpan>,
    },
    /// The real source-migration gate refused a legacy request before its handler.
    RequestBlocked {
        /// Destination document.
        doc: DocIx,
        /// Adapter route name.
        route: String,
    },
    /// The real atomic use case prepared this response; durable gate completion is separate.
    HttpPrepared {
        /// Destination document.
        doc: DocIx,
        /// Whether the optimistic update applied.
        applied: bool,
        /// Decoded response revision.
        revision: Vv,
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
    /// The real core selected exactly this source to initialize its host surface.
    Seeded {
        /// Client.
        client: ClientName,
        /// Owning session, distinct across reopens.
        session: SessionId,
        /// Real SeedKind diagnostic.
        kind: String,
        /// Own/orphan WAL rows replayed before the surface was initialized.
        replayed_wal: u32,
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
    /// A requested snapshot delete actually removed a stored snapshot.
    SnapshotDeleted {
        /// Durable profile.
        profile: ProfileName,
        /// Exact document key.
        doc: doc_sync_core::SyncDocId,
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
        /// Exact source/target document identity.
        doc: doc_sync_core::SyncDocId,
        /// Source sequences actually removed, including covered delivered rows.
        removed: Vec<WalSeq>,
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
        /// Exact storage identity.
        doc: doc_sync_core::SyncDocId,
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
        /// Actual instruction phase.
        phase: TelemetryPhase,
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
        /// Scheduled non-periodic work remains even when every client is idle.
        queued_non_periodic: bool,
    },
    /// Observed physical router socket transition, shared by a whole profile.
    RouterSocket {
        /// Browser/device sharing the connection.
        profile: ProfileName,
        /// Physical socket attempt.
        connection: u32,
        /// Whether the physical handshake succeeded.
        open: bool,
    },
    /// Actual rollback of delivered flags/rows during the injected power-loss window.
    WalDeliveryLost {
        /// Durable profile.
        profile: ProfileName,
        /// Exact storage identity.
        doc: doc_sync_core::SyncDocId,
        /// Original owner, including legacy rows.
        owner: doc_sync_core::WalOwner,
        /// Delivered sequences that actually disappeared or lost their flag.
        seqs: Vec<doc_sync_core::WalSeq>,
    },
    /// Actual deletion of delivered WAL rows covered by a durable snapshot.
    WalPruned {
        /// Durable profile.
        profile: ProfileName,
        /// Exact storage identity.
        doc: doc_sync_core::SyncDocId,
        /// Original owner.
        owner: doc_sync_core::SessionId,
        /// Removed sequences, distinguished from attempted prune requests.
        seqs: Vec<doc_sync_core::WalSeq>,
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
    /// Actual retained own rows confirmed delivered by the core, even above a parked gap.
    pub delivered: Vec<WalSeq>,
    /// Checksum-valid operation intervals retained in actual parked WAL rows.
    pub parked_spans: BTreeMap<WalSeq, Vec<IdSpan>>,
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
    /// Literal script transitions executed.
    pub steps: u64,
    /// Edits skipped by actual client lifecycle or authority.
    pub skipped_ops: u64,
    /// Observed tab crashes.
    pub crashes: u64,
    /// Observed browser-process crashes.
    pub profile_crashes: u64,
    /// Observed Room activation crashes.
    pub server_crashes: u64,
    /// Socket generations opened after the first per session.
    pub reconnects: u64,
    /// Transitions to the real exhausted-retry state.
    pub gave_up: u64,
    /// Real corruption resets started.
    pub resets: u64,
    /// Imports that actually retained missing dependencies.
    pub pending_imports: u64,
    /// Real incremental catchup attempts.
    pub converge_rounds: u64,
    /// Acknowledgment frames dropped by the network.
    pub acks_lost: u64,
    /// Maximum actual retained client WAL length.
    pub wal_max_depth: u64,
    /// Completed adoption transactions with moved rows.
    pub adoptions: u64,
    /// Pushes carrying rows owned by another live session.
    pub assisted_pushes: u64,
    /// Completed durable chatter-origin rows.
    pub foreign_rows: u64,
    /// Observed messages requiring multiple fragments.
    pub multi_frame_messages: u64,
    /// Observed authority transitions.
    pub access_changes: u64,
    /// Virtual time spent inside Settle transitions.
    pub settle_ms: u64,
    /// Actual retained parked rows in live final clients.
    pub parked_rows_at_end: u64,
    /// Profiles with two writable tabs of one document simultaneously.
    pub multi_edit_tab_profiles: u64,
    /// Issued appends completing after their owning tab crashed.
    pub late_commits_after_lock_release: u64,
    /// Observed callback failures from a directory outage.
    pub d1_outages: u64,
    /// Observed callback failures from operation-log storage outages.
    pub storage_outages: u64,
    /// Observed graceful closes before a pending coalesce deadline.
    pub close_in_window: u64,
    /// Actual foreign bytes on real peer pushes.
    pub foreign_bytes_pushed: u64,
    /// Actual own bytes on real peer pushes.
    pub own_bytes_pushed: u64,
    /// Actual applied operation kinds, including selection.
    pub ops_by_kind: BTreeMap<String, u64>,
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
    /// Foreign drivers require their caller-owned command/report transcript for replay.
    pub external_clients: Vec<ClientName>,
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
