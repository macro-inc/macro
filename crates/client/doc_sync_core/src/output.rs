use crate::*;

/// Ordered effects, session events, and the next timer deadline.
#[derive(Default)]
pub struct SyncOutput {
    /// Io.
    pub io: Vec<IoEffect>,
    /// Events.
    pub events: Vec<SyncEvent>,
    /// The earliest deadline the core holds. The host keeps exactly one timer.
    pub wake_at: Option<Millis>,
}

/// An I/O operation for the host to execute after handling an input.
pub enum IoEffect {
    /// Detach this session from its router; other routes and owners remain connected.
    RouteDetach {
        /// Route whose ownership the host must release.
        doc: SyncDocId,
    },
    /// Forward to `RouterInput::Reconnect` for this document without closing its shared socket.
    RouteReconnect {
        /// Route requiring a freshly authorized subscription.
        doc: SyncDocId,
    },
    /// Open the shared router socket; its route tokens are fetched separately.
    RouterConnect {
        /// Physical socket generation.
        conn: ConnId,
        /// Opener trace context propagated to the router.
        traceparent: Option<String>,
    },
    /// `doc` is the session's doc for `Direct`, and the route's doc from `RouterCore`.
    FetchToken {
        /// Authorization attempt correlation counter.
        attempt: u32,
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
    },
    /// Open a physical document connection.
    SocketConnect {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Opaque permission token; never include it in telemetry.
        token: SyncToken,
        /// Traceparent.
        traceparent: Option<String>,
    },
    /// One already-framed binary message. A large `FromPeer` yields several in order.
    SocketSend {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// One framed binary protocol message.
        frame: Vec<u8>,
    },
    /// Send the protocol heartbeat text.
    SocketPing {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
    },
    /// Close a physical connection.
    SocketClose {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// Transport close status code.
        code: u16,
        /// Reason for the state transition.
        reason: CloseCause,
    },
    /// Durable storage operation or completion.
    Storage {
        /// Storage operation correlation identifier.
        id: StorageOpId,
        /// Storage operation to execute.
        op: StorageOp,
    },
    /// Broadcast to other local sessions.
    ChatterPost(ChatterMessage),
    /// Emit telemetry through the host.
    Telemetry(TelemetryRecord),
}

/// A state change or reply delivered to the owning session.
pub enum SyncEvent {
    /// Public session status changed.
    Status(SyncStatus),
    /// Visible remote presence changed.
    Presence(Vec<PeerPresence>),
    /// A correlated host request completed.
    Reply {
        /// Host request correlation identifier.
        request: RequestId,
        /// Request completion payload.
        reply: Reply,
    },
    /// The doc was replaced (reset). The session re-initializes its surface.
    Replaced,
    /// A seed won. The session initializes its surface (editor init, §2.3).
    Seeded {
        /// Origin or operation kind.
        kind: SeedKind,
        /// Number of WAL rows replayed before initialization.
        replayed_wal: u32,
    },
    /// The effective access changed (W-6: `Authorization{can_write}` flipped). The editor
    /// starts or stops rejecting mutations.
    AccessChanged(Access),
}

/// A correlated host request completed.
pub enum Reply {
    /// Request or report delivery of outstanding changes.
    Flush(FlushReply), // Drained | NotDrained { undelivered: u32 } | Offline | ReadOnly
    /// Comment publication result.
    Comment(CommentReply), // Accepted | NotAcked | Refused(CommentRefusal)
    /// Fresh server snapshot result.
    Snapshot(Result<Vec<u8>, RequestFailure>), // RequestFailure: Timeout | Disconnected | Unauthorized
    /// `Stop` finished: the window was appended (or the append failed and was reported). The
    /// host drops the session only after this reply.
    Stopped,
}

/// Connection, durability, and import health exposed to the host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncStatus {
    /// Public connection state.
    pub connection: ConnectionStatus, // Connecting | Connected | Disconnected | Offline (gave up) | Closed(CloseReason)
    /// Public durability state.
    pub save: SaveState, // Saved | Saving | Unsaved(UnsavedReason::{Undelivered, Storage, ReadOnly, Poison, Gap, Rebasing})
    /// Whether Loro still needs missing dependencies.
    pub pending_import: bool, // Loro holds ops waiting on missing dependencies
}

/// A content-free telemetry instruction for the host.
pub struct TelemetryRecord {
    /// Host-managed span correlation key.
    pub span: SpanKey,
    /// Origin or operation kind.
    pub kind: TelemetryKind,
    /// Ordered content-free span attributes.
    pub attrs: Vec<(&'static str, AttrValue)>,
}
/// Start, annotate, or finish a host-managed span.
pub enum TelemetryKind {
    /// Begin a span or session operation.
    Start {
        /// Stable telemetry span or event name.
        name: &'static str,
    },
    /// Record an event on the correlated span.
    Event {
        /// Stable telemetry span or event name.
        name: &'static str,
    },
    /// Finish the correlated span.
    End {
        /// Stable operation outcome label.
        outcome: &'static str,
        /// Whether the operation ended in error.
        error: bool,
    },
}

/// Result of draining pending edits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FlushReply {
    /// All required updates were acknowledged.
    Drained,
    /// Retained rows prevent successful draining.
    NotDrained {
        /// Number of retained undelivered rows.
        undelivered: u32,
    },
    /// No live connection is available.
    Offline,
    /// Write authorization is absent.
    ReadOnly,
}
/// Result of publishing a comment update.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommentReply {
    /// The server accepted the comment update.
    Accepted,
    /// The update was not acknowledged before its deadline.
    NotAcked,
    /// The operation was rejected before submission.
    Refused(CommentRefusal),
}
/// Reason a comment update could not be submitted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommentRefusal {
    /// Staging could not obtain a fresh server snapshot.
    SnapshotFailed,
    /// The live document could not catch up to the staging base.
    CatchupFailed,
    /// The selection changed while publication was staged.
    SelectionChanged,
    /// Local edits could not be persisted before staging.
    LocalChangesPending,
    /// A comment update could not be constructed on the fork.
    StagingFailed,
    /// The host cancelled publication.
    Cancelled,
    /// Current authorization does not permit commenting.
    Unauthorized,
}
/// Failure to obtain a requested server snapshot.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RequestFailure {
    /// The deadline elapsed before completion.
    #[error("snapshot request timed out")]
    Timeout,
    /// The connection closed before completion.
    #[error("snapshot connection closed")]
    Disconnected,
    /// The session is no longer authorized.
    #[error("snapshot request is unauthorized")]
    Unauthorized,
}
/// Public connection state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionStatus {
    /// A connection is being established.
    Connecting,
    /// The transport is connected.
    Connected,
    /// The connection closed before completion.
    Disconnected,
    /// No live connection is available.
    Offline,
    /// The connection is permanently closed or reports a close event.
    Closed(CloseReason),
}
/// Terminal session reason.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CloseReason {
    /// The session has stopped.
    Stopped,
    /// The session is no longer authorized.
    Unauthorized,
    /// State could not be recovered within the reset budget.
    Corrupt,
}
/// Why the host must close a transport.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CloseCause {
    /// The heartbeat budget was exhausted.
    NoHeartbeat,
    /// Connection establishment exceeded its deadline.
    ConnectTimeout,
    /// The session has stopped.
    Stopped,
    /// The session is no longer authorized.
    Unauthorized,
    /// A fresh authorized connection replaces this one.
    Superseded,
    /// Frame reassembly or protocol decoding failed.
    ProtocolError,
}
/// Whether all local and imported changes are durably delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SaveState {
    /// All changes are durably delivered with no pending or parked work.
    Saved,
    /// Durability or acknowledgement work is in progress.
    Saving,
    /// A retained condition prevents a saved state.
    Unsaved(UnsavedReason),
}
/// Condition preventing a saved status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UnsavedReason {
    /// Some WAL rows lack durable acknowledgement.
    Undelivered,
    /// Durable storage operation or completion.
    Storage,
    /// Write authorization is absent.
    ReadOnly,
    /// A locally proven invalid row is retained in quarantine.
    Poison,
    /// A sequence gap prevents safe delivery.
    Gap,
    /// Updates depend on history below the shallow root.
    Rebasing,
}
/// A host-correlated span identifier; no trace context is generated in the core.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SpanKey(pub u64);
/// Content-free telemetry attribute.
#[derive(Clone, Debug, PartialEq)]
pub enum AttrValue {
    /// Text attribute without document content or credentials.
    String(String),
    /// Unsigned numeric attribute.
    U64(u64),
    /// Signed numeric attribute.
    I64(i64),
    /// Boolean attribute.
    Bool(bool),
}
/// A remote peer and its application-defined presence payload.
#[derive(Clone, Debug)]
pub struct PeerPresence {
    /// Presence entry key.
    pub key: String,
    /// Application-defined presence payload.
    pub value: loro::LoroValue,
}
