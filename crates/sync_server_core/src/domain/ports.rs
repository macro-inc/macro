//! Runtime capabilities required by a synchronization room.
//!
//! Port futures intentionally omit `Send` (CS-60), and their errors omit
//! `Send + Sync` (CS-56): the Worker adapter is single-threaded and its JavaScript
//! futures and errors cannot cross threads.
use super::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::{SourceState, TargetState},
    models::{BlameRow, PeerWithUserId},
    socket::{SocketTagError, WebSocketId},
    state::RootChange,
    types::{
        BlameEvent, DocumentKey, InteractionReason, OperationId, PeerId, PendingOperation,
        SessionKey,
    },
};
use std::{future::Future, time::Duration};

/// Wall-clock milliseconds since the Unix epoch. One type for server, client and presence.
pub use sync_protocol::time::UnixMillis; // `pub struct UnixMillis(pub i64)`

/// Observable purpose of a wall-clock read in the original callback.
#[derive(Clone, Copy, Debug)]
pub enum WallClock {
    /// Surface grant expiry.
    SurfaceExpiry,
    /// Comparison against the current durable alarm.
    AlarmCompare,
    /// Timestamp assigned to last-editor observations.
    Blame,
}
impl WallClock {
    /// Stable recording tag for exact clock replay.
    pub fn tag(self) -> &'static str {
        match self {
            Self::SurfaceExpiry => "surface_expiry_ms",
            Self::AlarmCompare => "alarm_compare_ms",
            Self::Blame => "blame_ms",
        }
    }
}
/// Wall and monotonic clocks supplied by the runtime.
pub trait Clock {
    /// Monotonic time since an arbitrary origin (today `web_time::Instant`, i.e. `performance.now()`).
    fn monotonic(&self) -> Duration;
    /// Wall clock (today `Date::now()` / `SystemTime::now()`; op ids use it as nanos = ms × 10⁶).
    fn unix_time(&self) -> UnixMillis;
    /// Read wall time at a named legacy callback boundary.
    fn unix_time_for(&self, purpose: WallClock) -> UnixMillis;
    /// Wall clock in nanoseconds, exactly what `OrederedIds` reads today.
    fn unix_nanos(&self) -> u128;
}

/// Identifiers supplied by the runtime entropy source.
pub trait Entropy {
    /// UUID v4 for a new socket tag. Stays v4: tags are persisted on hibernated sockets.
    fn socket_uuid(&self) -> uuid_types::Uuid;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Policy reasons for closing a session socket.
pub enum CloseReason {
    /// The source session is frozen or retired.
    SessionFrozenOrRetired, // "session frozen or retired"
    /// The surface has been revoked.
    SurfaceRevoked, // "surface revoked"
    /// The surface grant is no longer active.
    SurfaceGrantExpiredOrRevoked, // "surface grant expired or revoked"
    /// The document has been deleted.
    DocumentDeleted, // "document deleted"
}
impl CloseReason {
    /// WebSocket policy-violation close code.
    pub const CODE: u16 = 1008;
    /// The exact wire close reason.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SessionFrozenOrRetired => "session frozen or retired",
            Self::SurfaceRevoked => "surface revoked",
            Self::SurfaceGrantExpiredOrRevoked => "surface grant expired or revoked",
            Self::DocumentDeleted => "document deleted",
        }
    }
}

/// Hibernatable socket transport operations.
pub trait Connections {
    /// Runtime socket handle. Equality is socket identity (today `WebSocket: PartialEq`).
    type Socket: Clone + Eq;
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// Every socket the runtime holds for this object, hibernated or not, in runtime order.
    /// A socket whose close callback is running is still listed (CF semantics, X4).
    fn all(&self) -> Vec<Self::Socket>;
    /// The socket's tag. Fails when the first tag is missing or lacks the `ws_id` prefix.
    fn socket_id(&self, socket: &Self::Socket) -> Result<WebSocketId, SocketTagError>;
    /// Accept a new hibernatable socket tagged `id` (adapter: `WebSocketPair` + `accept_websocket_with_tags`).
    fn accept(&self, id: &WebSocketId) -> Result<Self::Socket, Self::Error>;
    /// Send an already-framed binary message.
    fn send_binary(&self, socket: &Self::Socket, frame: &[u8]) -> Result<(), Self::Error>;
    /// Send an unframed text heartbeat.
    fn send_text(&self, socket: &Self::Socket, text: &str) -> Result<(), Self::Error>;
    /// Close a runtime socket with a policy reason.
    fn close(&self, socket: &Self::Socket, reason: CloseReason) -> Result<(), Self::Error>;
}

/// Durable Object transactional storage, typed. The adapter owns key spelling and value encoding.
pub trait RoomStorage {
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// Read the persisted session identity.
    fn session_key(&self) -> impl Future<Output = Result<Option<SessionKey>, Self::Error>>;
    /// Persist the session identity.
    fn put_session_key(&self, key: &SessionKey) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read one persisted connection record.
    fn connection(
        &self,
        id: &WebSocketId,
    ) -> impl Future<Output = Result<Option<ConnectionMetadata>, Self::Error>>;
    /// Persist one connection record.
    fn put_connection(
        &self,
        id: &WebSocketId,
        metadata: &ConnectionMetadata,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Delete one connection record.
    fn delete_connection(&self, id: &WebSocketId) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read the surface lifecycle.
    fn surface_lifecycle(
        &self,
    ) -> impl Future<Output = Result<Option<SurfaceLifecycle>, Self::Error>>;
    /// Persist the surface lifecycle.
    fn put_surface_lifecycle(
        &self,
        lifecycle: SurfaceLifecycle,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read the source migration phase.
    fn source_migration(&self) -> impl Future<Output = Result<Option<SourceState>, Self::Error>>;
    /// Persist the source migration phase.
    fn put_source_migration(
        &self,
        state: &SourceState,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read the target migration phase.
    fn target_migration(&self) -> impl Future<Output = Result<Option<TargetState>, Self::Error>>;
    /// Persist the target migration phase.
    fn put_target_migration(
        &self,
        state: &TargetState,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read the version vector saved with the last snapshot.
    fn saved_version_vector(&self) -> impl Future<Output = Result<Option<Vec<u8>>, Self::Error>>;
    /// Persist the encoded saved version vector.
    fn put_saved_version_vector(
        &self,
        encoded: &[u8],
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// `o/*` in key order. A per-entry error is an unreadable entry (logged and skipped, H8).
    fn pending_operations(
        &self,
    ) -> impl Future<Output = Result<Vec<Result<PendingOperation, Self::Error>>, Self::Error>>;
    /// Persist an unmodified pending update.
    fn put_pending_operation(
        &self,
        id: &OperationId,
        update: &[u8],
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Archive an unmodified update.
    fn put_archived_operation(
        &self,
        id: &OperationId,
        update: &[u8],
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Persist the signed attribution associated with an operation.
    fn put_operation_attribution(
        &self,
        id: &OperationId,
        attribution: &DocumentAttribution,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Returns how many were deleted (a mismatch is logged, A4).
    fn delete_pending_operations(
        &self,
        ids: &[OperationId],
    ) -> impl Future<Output = Result<usize, Self::Error>>;
    /// Delete all transactional session data.
    fn delete_all(&self) -> impl Future<Output = Result<(), Self::Error>>;
}

#[derive(Debug, thiserror::Error)]
/// A missing snapshot or a storage transport failure.
pub enum SnapshotReadError<StorageError: std::error::Error + 'static> {
    #[error("no snapshot is stored")]
    /// No snapshot is stored for this identity.
    Missing,
    #[error(transparent)]
    /// The storage adapter failed to read the snapshot.
    Storage(StorageError),
}

/// The session snapshot (today: DO SQL with a Worker KV fallback) and the migration export slot.
pub trait SnapshotStore {
    /// Construct a fresh session transport (including the legacy SQL table setup).
    /// Exists and initialize do this on every request, even when the snapshot is absent.
    fn prepare(&self, key: &SessionKey) -> Result<(), Self::Error>;
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// Whether a session snapshot is stored.
    fn has(&self, key: &SessionKey) -> impl Future<Output = Result<bool, Self::Error>>;
    /// Read the session snapshot.
    fn get(
        &self,
        key: &SessionKey,
    ) -> impl Future<Output = Result<Vec<u8>, SnapshotReadError<Self::Error>>>;
    /// Persist the session snapshot.
    fn put(
        &self,
        key: &SessionKey,
        snapshot: &[u8],
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Removes the fallback copy first, then the primary copy.
    fn delete(&self, key: &SessionKey) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read a frozen migration export.
    fn export(
        &self,
        operation: uuid_types::Uuid,
    ) -> impl Future<Output = Result<Vec<u8>, SnapshotReadError<Self::Error>>>;
    /// Persist a frozen migration export.
    fn put_export(
        &self,
        operation: uuid_types::Uuid,
        snapshot: &[u8],
    ) -> impl Future<Output = Result<(), Self::Error>>;
}

/// Durable wakeup scheduling.
pub trait AlarmScheduler {
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// Read the current durable alarm deadline.
    fn scheduled(&self) -> impl Future<Output = Result<Option<UnixMillis>, Self::Error>>;
    /// Schedule a wakeup after the supplied delay.
    fn schedule_in(&self, delay: Duration) -> impl Future<Output = Result<(), Self::Error>>;
    /// Cancel the durable alarm.
    fn cancel(&self) -> impl Future<Output = Result<(), Self::Error>>;
}

/// D1 `peer_user_map` and blame. The in-memory fake must reproduce the SQL conflict semantics.
pub trait PeerDirectory {
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// `insert_user_mapping`: inserts, or takes over a peer only while the system author holds it.
    fn claim_peer(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peer: PeerId,
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// `insert_missing_user_mappings`: `INSERT OR IGNORE` for each peer.
    fn map_unowned_peers(
        &self,
        document: &SessionKey,
        user: &str,
        actor: Option<&str>,
        peers: &[PeerId],
    ) -> impl Future<Output = Result<(), Self::Error>>;
    /// Read the user recorded for one peer.
    fn user_for_peer(
        &self,
        document: &SessionKey,
        peer: PeerId,
    ) -> impl Future<Output = Result<Option<String>, Self::Error>>;
    /// Read all registered peers for the session.
    fn peers(
        &self,
        document: &SessionKey,
    ) -> impl Future<Output = Result<Vec<PeerWithUserId>, Self::Error>>;
    /// Read last-edit attribution for a node.
    fn blame_for_node(
        &self,
        document: &SessionKey,
        node: &str,
    ) -> impl Future<Output = Result<Option<BlameRow>, Self::Error>>;
    /// Delete the session peer and blame records.
    fn delete_document(
        &self,
        document: &SessionKey,
    ) -> impl Future<Output = Result<(), Self::Error>>;
}

/// Comment-only change validation.
pub trait CommentGate {
    /// Adapter-specific failure without thread-safety requirements.
    type Error: std::error::Error + 'static;
    /// **The gate stays an HTTP port in this pass (R2).** Production: lexical-service
    /// `/comment-only-change` over HTTP, unchanged; the sync-service adapter
    /// (`outbound/lexical_service.rs` after C9) implements this port and owns the 4.5 s timeout
    /// and the `comment_gate.check` span (`outcome`, `error.kind`, `ms`, `document.id`).
    /// The fuzz sim uses `InProcessCommentGate` (in `sync_sim`, dev-only, over
    /// `macro_document_model`), trusted only while the S8 §13 parity test passes. No in-process
    /// production gate ships in this pass: S3's route-group-3 edit of `socket/protocol.rs:387`
    /// targets a file C16 deletes and is superseded. A later flip, after PR 5/6, is its own PR
    /// that implements this port in-process in `sync_server_core` behind a feature, selected by
    /// a Worker `[env.*.vars]` value in every env block plus `wrangler.docker.toml`; the sim then
    /// reuses that one impl (CS-26) and the S8 §13 parity test becomes the flip gate.
    fn is_comment_only_change(
        &self,
        change: &RootChange,
    ) -> impl Future<Output = Result<bool, Self::Error>>;
}

/// Work that must not delay the callback (today `state.wait_until`). Implementations never fail the caller.
pub trait BackgroundEffects {
    /// Schedule document publication without delaying the callback.
    fn publish(&self, publication: DocumentPublication);
    /// Schedule a batch of last-edit observations.
    fn record_blame(&self, events: Vec<BlameEvent>);
    /// Keep the isolate alive (today the JS `setTimeout` in `keepalive.rs`).
    fn extend_isolate_lifetime(&self, ttl: Duration);
}

/// A deferred document notification.
pub enum DocumentPublication {
    /// Preserve a scheduled task whose document-only body has no work.
    Noop,
    /// Send a shallow snapshot, content update and optional interaction.
    Snapshot {
        /// Document receiving the notification.
        document: DocumentKey,
        /// Exported shallow snapshot bytes.
        snapshot: Vec<u8>,
        /// Verified editors since the preceding snapshot.
        editors: Vec<DocumentAttribution>,
        /// Optional lifecycle interaction to publish after the snapshot.
        interaction: Option<InteractionReason>,
    },
    /// Publish a lifecycle interaction without a snapshot.
    Interaction {
        /// Document receiving the notification.
        document: DocumentKey,
        /// Lifecycle interaction.
        reason: InteractionReason,
    },
}

/// Bundles the ports so `Room` has a single type parameter.
pub trait RoomPorts {
    /// Wall and monotonic clocks supplied by the runtime.
    type Clock: Clock;
    /// Identifiers supplied by the runtime entropy source.
    type Entropy: Entropy;
    /// Hibernatable socket transport operations.
    type Connections: Connections;
    /// Transactional session storage.
    type Storage: RoomStorage;
    /// Snapshot persistence.
    type Snapshots: SnapshotStore;
    /// Durable alarm scheduling.
    type Alarm: AlarmScheduler;
    /// Peer attribution directory.
    type Peers: PeerDirectory;
    /// Comment-only change validation.
    type CommentGate: CommentGate;
    /// Deferred effect delivery.
    type Background: BackgroundEffects;
    /// The runtime clock source.
    fn clock(&self) -> &Self::Clock;
    /// The runtime entropy source.
    fn entropy(&self) -> &Self::Entropy;
    /// The runtime socket transport.
    fn connections(&self) -> &Self::Connections;
    /// Transactional session storage.
    fn storage(&self) -> &Self::Storage;
    /// Session and migration snapshot storage.
    fn snapshots(&self) -> &Self::Snapshots;
    /// Durable alarm scheduling.
    fn alarm(&self) -> &Self::Alarm;
    /// Read all registered peers for the session.
    fn peers(&self) -> &Self::Peers;
    /// Comment-only change validation.
    fn comment_gate(&self) -> &Self::CommentGate;
    /// Deferred effects.
    fn background(&self) -> &Self::Background;
}
