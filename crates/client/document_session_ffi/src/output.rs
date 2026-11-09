//! Owned typed host effects. No binary Diff or session message encoding.
use crate::*;
/// Complete output of one admitted input, owned by the caller.
#[derive(uniffi::Record)]
pub struct FfiOutput {
    /// Ordered host view actions.
    pub view: Vec<FfiViewEffect>,
    /// Ordered host I/O instructions.
    pub io: Vec<FfiIoEffect>,
    /// Deadline for the host's single timer.
    pub wake_at_ms: Option<u64>,
    /// Host should refill fresh CRDT identities.
    pub need_peer_ids: bool,
}
/// A correlated flush, stop, snapshot or comment result.
#[derive(uniffi::Enum)]
pub enum FfiReply {
    /// Graceful stop completed after the terminal append.
    Stopped,
    /// Flush completed or retained a durable condition.
    Flush {
        /// Flush result.
        result: FlushReply,
    },
    /// Comment publication completed.
    Comment {
        /// Publication result.
        result: CommentReply,
    },
    /// Server snapshot obtained successfully.
    Snapshot {
        /// Native snapshot bytes.
        bytes: Vec<u8>,
    },
    /// Server snapshot request failed.
    SnapshotFailed {
        /// Failure reason.
        error: RequestFailure,
    },
}
/// Typed view output, including full Diff reconciliation metadata.
#[derive(uniffi::Enum)]
pub enum FfiViewEffect {
    /// Initial editor paint.
    Initialize {
        /// Structural view patch.
        diff: Diff,
        /// Serialized root as typed properties.
        root: SerializedNode,
    },
    /// Initial generic observed values.
    InitializeDoc {
        /// Values paired with their complete paths.
        values: Vec<FfiObservedValue>,
    },
    /// Incremental native editor Diff.
    Diff {
        /// Ordered structured Diff operations.
        diff: Diff,
    },
    /// Install a complete resolved selection and typing style.
    SetSelection {
        /// Native selection including node/table variants.
        selection: ViewSelection,
        /// Typing format bits.
        format: TextFormat,
        /// Typing style.
        style: String,
    },
    /// Scroll a model node into view.
    ScrollIntoView {
        /// Model identity.
        key: NodeKey,
    },
    /// Update decorators.
    Decorators {
        /// Affected model identities.
        keys: Vec<NodeKey>,
    },
    /// Undo/redo availability changed.
    HistoryState {
        /// Native collaborative history availability.
        availability: HistoryAvailability,
    },
    /// Root text content changed.
    TextContentChanged,
    /// Non-range selection changed.
    SelectionChange,
    /// Suppress the host's default input action.
    PreventDefault,
    /// Schedule removal of an empty composition text node.
    ScheduleRemoveEmptyText {
        /// Text identity.
        key: NodeKey,
        /// Delay on the host clock.
        delay_ms: u32,
    },
    /// A plugin emitted a typed event identified by its registered name.
    PluginEvent {
        /// Stable event name.
        name: String,
    },
    /// A follow-up failed after earlier commits already published.
    FollowUpFailed {
        /// Plugin name.
        plugin: String,
        /// Stable error class.
        kind: String,
        /// Native diagnostic.
        message: String,
    },
    /// Remote local ids were allocated.
    RemoteNodesCreated {
        /// Allocated identities.
        nodes: Vec<FfiCreatedNode>,
    },
    /// Generic container changes.
    DocChanged {
        /// Ordered native container deltas.
        changes: Vec<FfiDocEvent>,
    },
    /// Connection/save/import status.
    Status {
        /// Full native reasons retained.
        status: SyncStatus,
    },
    /// Remote cursor/presence values.
    Presence {
        /// Peer values.
        peers: Vec<PeerPresence>,
    },
    /// Correlated host request completed.
    Reply {
        /// Request correlation.
        request: RequestId,
        /// Typed result.
        reply: FfiReply,
    },
    /// Semantic tags from admitted editor commits.
    CommitTags {
        /// Tags from committed editor updates.
        tags: Vec<String>,
    },
    /// Complete replacement of the visible remote cursor set.
    Cursors {
        /// Resolved model selections and presentation metadata.
        peers: Vec<FfiEditorPeerSelection>,
    },
    /// Finish the platform composition before applying bounded remote work.
    EndComposition,
    /// Input or initialization failure.
    Error {
        /// Native error text.
        message: String,
    },
}
/// A newly allocated native node from a batch-local id.
#[derive(uniffi::Record)]
pub struct FfiCreatedNode {
    /// Batch-local id.
    pub local: u32,
    /// Actual model identity.
    pub key: NodeKey,
}
/// One initially observed generic value.
#[derive(uniffi::Record)]
pub struct FfiObservedValue {
    /// Complete path.
    pub path: ContainerPath,
    /// Native deep value.
    pub value: DocValue,
}
/// One generic map entry change.
#[derive(uniffi::Record)]
pub struct FfiMapChange {
    /// Map entry key.
    pub key: String,
    /// None removes the entry.
    pub value: Option<DocValue>,
}
/// Generic container change with native text/list units preserved.
#[derive(uniffi::Enum)]
pub enum FfiDocEvent {
    /// Map delta.
    Map {
        /// Complete path.
        path: ContainerPath,
        /// Changed entries.
        updated: Vec<FfiMapChange>,
    },
    /// Native list or movable-list delta.
    ListChanged {
        /// Complete path.
        path: ContainerPath,
        /// Ordered delta.
        delta: Vec<FfiListDelta>,
    },
    /// Text delta with Unicode scalar lengths and native attributes.
    Text {
        /// Complete path.
        path: ContainerPath,
        /// Ordered delta.
        delta: Vec<FfiTextDelta>,
    },
}
/// Native sequence delta.
#[derive(uniffi::Enum)]
pub enum FfiListDelta {
    /// Retain values.
    Retain {
        /// Value count.
        count: u64,
    },
    /// Delete values.
    Delete {
        /// Value count.
        count: u64,
    },
    /// Insert or move values.
    Insert {
        /// Deep values.
        values: Vec<DocValue>,
        /// Whether this insertion moves existing values.
        is_move: bool,
    },
}
/// Native text delta; attribute values are typed CRDT scalars.
#[derive(uniffi::Enum)]
pub enum FfiTextDelta {
    /// Retain Unicode scalar positions.
    Retain {
        /// Scalar count.
        count: u64,
        /// Updated attributes.
        attributes: Option<HashMap<String, NativeValue>>,
    },
    /// Insert text.
    Insert {
        /// Inserted UTF-8 text.
        text: String,
        /// Text attributes.
        attributes: Option<HashMap<String, NativeValue>>,
    },
    /// Delete Unicode scalar positions.
    Delete {
        /// Scalar count.
        count: u64,
    },
}
/// A content-free native telemetry action.
#[derive(uniffi::Enum)]
pub enum FfiTelemetryKind {
    /// Start a span.
    Start {
        /// Stable span name.
        name: String,
    },
    /// Annotate a span with an event.
    Event {
        /// Stable event name.
        name: String,
    },
    /// End a span.
    End {
        /// Outcome label.
        outcome: String,
        /// Error state.
        error: bool,
    },
}
/// One content-free telemetry attribute.
#[derive(uniffi::Record)]
pub struct FfiAttribute {
    /// Stable attribute name.
    pub key: String,
    /// Typed scalar.
    pub value: AttrValue,
}
/// Host-managed span correlation and attributes.
#[derive(uniffi::Record)]
pub struct FfiTelemetry {
    /// Native operation correlation, not a network trace id.
    pub span: u64,
    /// Span action.
    pub kind: FfiTelemetryKind,
    /// Content-free attributes.
    pub attrs: Vec<FfiAttribute>,
}
/// Host-executed I/O. Native calls never perform storage or socket operations.
#[derive(uniffi::Enum)]
pub enum FfiIoEffect {
    /// Obtain a fresh permission token.
    FetchToken {
        /// Attempt correlation.
        attempt: u32,
        /// Transport document key.
        doc: SyncDocId,
    },
    /// Open a physical document socket; host supplies its configured base URL.
    SocketConnect {
        /// Connection generation.
        conn: ConnId,
        /// Transport document key.
        doc: SyncDocId,
        /// Opaque token.
        token: String,
        /// Opener context.
        traceparent: Option<String>,
    },
    /// Send already-framed protocol bytes.
    SocketSend {
        /// Connection generation.
        conn: ConnId,
        /// Native protocol frame.
        frame: Vec<u8>,
    },
    /// Send the protocol heartbeat.
    SocketPing {
        /// Connection generation.
        conn: ConnId,
    },
    /// Close a physical socket.
    SocketClose {
        /// Connection generation.
        conn: ConnId,
        /// Close code.
        code: u16,
        /// Native reason.
        reason: CloseCause,
    },
    /// Perform one durable operation and later admit its correlated completion.
    Storage {
        /// Operation correlation.
        op: StorageOpId,
        /// Native durable operation.
        op_body: StorageOp,
    },
    /// Forward a content-free telemetry action.
    Telemetry {
        /// Native telemetry data.
        record: FfiTelemetry,
    },
}

/// A remote editor cursor resolved against the current live document.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiEditorPeerSelection {
    /// Presence identity, scoped to this session.
    pub key: String,
    /// Application palette color.
    pub color: String,
    /// Resolved model endpoints.
    pub selection: ViewSelection,
}
