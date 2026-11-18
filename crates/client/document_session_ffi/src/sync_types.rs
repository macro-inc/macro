//! Typed native definitions; remote scaffolding validates the mirror against Rust.
use crate::*;

/// Native SyncConfig; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct SyncConfig {
    /// Document or collaborative-surface transport key.
    pub doc: SyncDocId,
    /// Unique host-supplied identity for this session.
    pub session: SessionId,
    /// Opaque signed-in user identity used to isolate WAL ownership.
    pub user: UserKey,
    /// Live transport strategy.
    pub transport: TransportKind,
    /// Durable or memory-only persistence strategy.
    pub persistence: Persistence,
    /// Effective write capability.
    pub access: Access,
    /// The token the page already fetched, used for the first connect only (helpers.ts
    /// `initialUrl`). `None` for a cached open: every connect is freshly authorized and
    /// there is no stale-token fallback.
    pub initial_token: Option<SyncToken>,
    /// Joins the sync-service spans to the opener's trace (`?traceparent=`).
    pub traceparent: Option<String>,
    /// Operation timeout settings.
    pub timeouts: Timeouts,
    /// Connection liveness settings.
    pub heartbeat: HeartbeatPolicy,
    /// Reconnect delay settings.
    pub backoff: BackoffPolicy,
    /// Convergence retry settings.
    pub converge: ConvergePolicy,
    /// WAL scheduling and retention settings.
    pub wal: WalPolicy,
    /// `Some(5_000)` for every durable surface today (engine.ts `SNAPSHOT_INTERVAL_MS`).
    pub snapshot_interval: Option<Millis>,
    /// Ephemeral presence settings.
    pub presence: PresencePolicy,
    /// Gossip updates and presence to co-located sessions (BroadcastChannel). Requires
    /// `Persistence::Durable` (W-10); `new` rejects `chatter` with `Memory`.
    pub chatter: bool,
    /// Bound on started corruption resets.
    pub reset_budget: ResetBudget,
}

/// Native TransportKind; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum TransportKind {
    /// One socket to `{SYNC_SERVICE_HOSTS.ws}/document/{doc}/connect?token=…`.
    Direct,
    /// A route on the page's shared DSS `/sync/ws` router socket, owned by `RouterCore`.
    Routed,
    /// No live transport. ai-editing-worker's non-propagating sessions and tests
    /// (`createNoopLiveSyncSource`). A flush replies `Drained` immediately.
    None,
}

/// Native Persistence; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum Persistence {
    /// Storage effects are emitted: IndexedDB or Turso.
    Durable,
    /// The WAL lives in memory only (`InMemoryWALStore`). No storage effects at all.
    Memory,
}

/// Native Access; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum Access {
    /// Document edits and comment marks are permitted.
    Edit,
    /// Only comment marks are permitted.
    CommentOnly,
    /// Document mutations are prohibited.
    Read,
}

/// Native Timeouts; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct Timeouts {
    /// Initial synchronization timeout.
    pub initial_sync: Millis, // 10_000
    /// Durable acknowledgement timeout.
    pub ack: Millis, //  5_000; server acks only after durable store, its budget is 4.5 s
    /// Snapshot bytes or response timeout.
    pub snapshot: Millis, // 10_000
    /// Incremental history request timeout.
    pub request_since: Millis, // 10_000
    /// Connection establishment timeout.
    pub connect: Millis, // 15_000; new: a socket stuck CONNECTING is abandoned
    /// Storage completion timeout.
    pub storage: Millis, // 10_000; bounds `Flush` waiting on `Writing` entries (§2.4)
}

/// Native HeartbeatPolicy; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct HeartbeatPolicy {
    /// Interval between scheduled pings.
    pub interval: Millis,
    /// Time allowed before the operation expires.
    pub timeout: Millis,
    /// Number of missed pongs tolerated.
    pub max_missed: u8,
}

/// Native BackoffPolicy; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct BackoffPolicy {
    /// Base delay before exponential backoff.
    pub base: Millis,
    /// Cap on the retry exponent.
    pub max_exponent: u8,
    /// Maximum reconnect attempts before giving up.
    pub max_retries: u32,
}

/// Native ConvergePolicy; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct ConvergePolicy {
    /// Maximum convergence attempts.
    pub max_attempts: u8,
    /// Delay between convergence attempts.
    pub retry_delay: Millis,
}

/// Native WalPolicy; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct WalPolicy {
    /// Local changes are exported and appended at most once per window. This is the knob
    /// that keeps typing at one wasm call per keystroke.
    pub coalesce: Millis, // 25
    /// Retention duration for undelivered orphan rows.
    pub ttl: Millis, // 7 days; undelivered entries older than this are dropped on load
    /// Minimum age before an unacknowledged update is retried.
    pub retry_unacked_after: Millis, // 5_000; matches today's 5 s snapshot-tick retry cadence
}

/// Native PresencePolicy; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct PresencePolicy {
    /// A duration compared against **wall** time (`UnixMillis`), because peers stamp entries
    /// with their own wall clock and the receiver drops `now.wall - timestamp > timeout`.
    pub timeout: WallDuration, // 10_000 (markdown passes 5_000)
    /// Re-send an unchanged local presence this often while connected (forms and
    /// spreadsheets: 3_000). `None` for markdown.
    pub refresh: Option<Millis>,
    /// User identity and cursor color announced to peers.
    pub user: PresenceUser, // { user_id: Option<MacroUserId>, color: PaletteColor }
    /// `Peer` (the local peer id string, every browser/native editor) or `Fixed(key)`: the
    /// ai-editing-worker's UUID key with the `(AI)` label, `refresh = Some(2_000)` sending
    /// `encode_all`, and a 700 ms linger before `Stop` clears it (`ai-peer.ts`, F21.4).
    pub key: PresenceKeyMode,
}

/// Native ResetBudget; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct ResetBudget {
    /// Maximum resets in the rolling window.
    pub max: u8,
    /// Rolling reset accounting duration.
    pub window: Millis,
}

/// Native PresenceUser; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct PresenceUser {
    /// Opaque user identity, absent for anonymous presence.
    pub user_id: Option<NativeUserId>,
    /// Presence palette value chosen by the host.
    pub color: PaletteColor,
}

/// Native PaletteColor; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum PaletteColor {
    /// Red cursor.
    Red,
    /// Orange cursor.
    Orange,
    /// Yellow cursor.
    Yellow,
    /// Lime cursor.
    Lime,
    /// Green cursor.
    Green,
    /// Teal cursor.
    Teal,
    /// Cyan cursor.
    Cyan,
    /// Blue cursor.
    Blue,
    /// Violet cursor.
    Violet,
    /// Purple cursor.
    Purple,
    /// Pink cursor.
    Pink,
}

/// Native PresenceKeyMode; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum PresenceKeyMode {
    /// Use the document peer id as the presence key.
    Peer,
    /// Use the supplied stable presence key.
    Fixed(String),
}

/// Native SocketEvent; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum SocketEvent {
    /// The physical transport is open.
    Opened,
    /// One binary wire frame (`[is_final, …chunk]`). Reassembled per `ConnId` in Rust.
    Frame(Vec<u8>),
    /// A text message. Only `"pong"` is meaningful.
    Text(String),
    /// The platform's error, then close. Tauri read errors arrive as `Closed { code: 1006 }`.
    Closed {
        /// Transport close status code.
        code: u16,
        /// Whether the transport reported a clean close.
        clean: bool,
    },
}

/// Native WriteAccess; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum WriteAccess {
    /// All document writes are permitted.
    Full,
    /// Only comment-mark updates are permitted.
    CommentMarks,
    /// No write capability or no live transport.
    None,
}

/// Native HostSignal; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum HostSignal {
    /// `window` `online` or `visibilitychange → visible` (source.ts). Reconnect only if down.
    /// Every host signal carries a fresh `Now.wall` (wasm `host(signal, now, wall)`), which
    /// re-bases the session's wall clock after a suspend (§4.1).
    Online,
    /// The host became visible.
    Visible,
    /// `visibilitychange → hidden` or `pagehide`: flush the coalesced WAL write now instead
    /// of waiting out the window, and post `ChatterMessage::Closing` on pagehide.
    Hidden,
    /// The host page is being hidden or unloaded.
    PageHide,
}

/// Native AuthorizationState; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct AuthorizationState {
    /// Whether this is still the active signed-in account.
    pub current: bool,
    /// Whether current authorization permits document writes.
    pub can_write: bool,
    /// Whether current authorization permits comment marks.
    pub can_comment: bool,
}

/// Native StorageOp; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum StorageOp {
    /// The snapshot, plus every orphaned owner's rows for `doc` (O-2) and, read-only, every
    /// live foreign owner's undelivered rows (`assist`, O-5). Rows of a different `user` are
    /// never returned (O-2).
    Load {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Opaque signed-in user identity used to isolate WAL ownership.
        user: UserKey,
    },
    /// Re-read orphans and assist rows only (on every `Synced`, on `ChatterMessage::Closing`,
    /// and when convergence ends still pending).
    LoadOrphans {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Opaque signed-in user identity used to isolate WAL ownership.
        user: UserKey,
    },
    /// Idempotent on `(doc, owner, seq)`: a row that already exists is left as is (SC-6).
    /// `retry` is true only on the re-emit after `Uncertain` (SC-3); only then does the IDB
    /// adapter scan for an existing row (§4.4).
    WalAppend {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Durable WAL row contents.
        record: WalRecord,
        /// Whether this repeats an append with an uncertain outcome.
        retry: bool,
    },
    /// Set `delivered` on every row of `owner` with seq ≤ `through`, in one transaction.
    WalMarkDelivered {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Inclusive sequence bound for this operation.
        through: WalSeq,
    },
    /// Delete own rows with seq ≤ `through`. Issued only after a snapshot covering them is
    /// durable and they are delivered (W-9).
    WalPrune {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Inclusive sequence bound for this operation.
        through: WalSeq,
    },
    /// One transaction, conditional on each row's `owner == from`: rewrite `owner` to `to` and
    /// renumber `seq` from `first_seq` in place, for every row of `from` with
    /// `seq > covers_for(from)` or `!delivered`, preserving `delivered`, `created_at`, `user`
    /// `foreign` and `quarantined`; delete the rest of `from`'s rows (delivered and covered by the snapshot).
    /// `covers_for(from)` is the snapshot's `covers.seq` when `covers.owner == from`, else 0.
    /// Atomic for legacy rows too (no copy-then-delete).
    WalAdopt {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Previous or expiring WAL owner.
        from: WalOwner,
        /// Session receiving adopted rows.
        to: SessionId,
        /// First sequence assigned to adopted rows.
        first_seq: WalSeq,
        /// WAL prefix already represented by the stored snapshot.
        covers: WalSeq,
        /// Exact loaded source rows; reject changed nonempty sources atomically.
        expected: Vec<StoredWalRecord>,
    },
    /// Drop `from`'s undelivered rows with `created_at < before` (TTL, W-7). `from` is an orphan,
    /// `Legacy`, or another user's owner (O-2: `Load` reports other users' expired rows for this
    /// op only), never a live owner.
    WalDropExpired {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Previous or expiring WAL owner.
        from: WalOwner,
        /// Exclusive wall-clock expiry cutoff.
        before: UnixMillis,
    },
    /// Park one own row proven poison (W-11): set `quarantined = true`. Never a delete; the
    /// row stays until TTL (W-7) so nothing a user typed is removed by inference.
    WalQuarantine {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Session owning the row or load request.
        owner: SessionId,
        /// Sequence number within one owner’s WAL.
        seq: WalSeq,
    },
    /// Snapshot save.
    SnapshotSave {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
        /// Opaque serialized document bytes.
        bytes: Vec<u8>,
        /// WAL prefix already represented by the stored snapshot.
        covers: Option<WalCover>,
    },
    /// Snapshot delete.
    SnapshotDelete {
        /// Document or collaborative-surface transport key.
        doc: SyncDocId,
    },
}

/// Native WalRecord; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct WalRecord {
    /// Sequence number within one owner’s WAL.
    pub seq: WalSeq,
    /// Wall-clock timestamp when the row was created.
    pub created_at: UnixMillis,
    /// Opaque signed-in user identity used to isolate WAL ownership.
    pub user: UserKey,
    /// Bytes this session imported from chatter and stores on behalf of their writer (W-10).
    /// `export_local` never re-exports them; they are delivered per W-10.5 and pruned like own
    /// rows, and never posted to chatter.
    pub foreign: bool,
    /// Parked as proven poison (W-11). Kept until TTL, never pushed, never deleted early.
    pub quarantined: bool,
    /// Opaque serialized document bytes.
    pub bytes: Vec<u8>,
}

/// Native StoredWalRecord; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct StoredWalRecord {
    /// Durable WAL row contents.
    pub record: WalRecord,
    /// Whether the server durably acknowledged this row.
    pub delivered: bool,
}

/// Native LocalState; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct LocalState {
    /// `None` also when the stored snapshot is empty (`byteLength == 0`, S5 §2.3
    /// `hasLocalSnapshot`): the executor maps `Some(empty)` to `None`.
    pub snapshot: Option<StoredSnapshot>, // { bytes, covers: Option<WalCover> }
    /// Owners with no live lease (O-2), plus `Legacy`. Same `user` only.
    pub orphans: Vec<OrphanWal>, // { owner: WalOwner, records: Vec<StoredWalRecord> }
    /// Undelivered rows of live foreign owners (frozen or old tabs), read-only (O-5).
    pub assist: Vec<OrphanWal>,
}

/// Native StorageFailure; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum StorageFailure {
    /// Storage could not be opened or reached.
    Unavailable,
    /// The store refused the write due to quota.
    QuotaExceeded,
    /// Persisted bytes or metadata could not be decoded safely.
    Corrupt,
    /// The store can't tell whether the write committed (a Turso commit whose fsync result was
    /// lost, an IDB transaction aborted after `complete` was queued). Never triggers a wipe.
    Uncertain,
    /// An otherwise unclassified storage failure.
    Other,
}

/// Native StoredSnapshot; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct StoredSnapshot {
    /// Opaque serialized document bytes.
    pub bytes: Vec<u8>,
    /// WAL prefix already represented by the stored snapshot.
    pub covers: Option<WalCover>,
}

/// Native OrphanWal; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct OrphanWal {
    /// Session owning the row or load request.
    pub owner: WalOwner,
    /// Rows sorted in owner sequence order.
    pub records: Vec<StoredWalRecord>,
}

/// Native SyncStatus; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct SyncStatus {
    /// Public connection state.
    pub connection: ConnectionStatus, // Connecting | Connected | Disconnected | Offline (gave up) | Closed(CloseReason)
    /// Public durability state.
    pub save: SaveState, // Saved | Saving | Unsaved(UnsavedReason::{Undelivered, Storage, ReadOnly, Poison, Gap, Rebasing})
    /// Whether Loro still needs missing dependencies.
    pub pending_import: bool, // Loro holds ops waiting on missing dependencies
}

/// Native FlushReply; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native CommentReply; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum CommentReply {
    /// The server accepted the comment update.
    Accepted,
    /// The update was not acknowledged before its deadline.
    NotAcked,
    /// The operation was rejected before submission.
    Refused(CommentRefusal),
}

/// Native CommentRefusal; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native RequestFailure; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum RequestFailure {
    /// The deadline elapsed before completion.
    Timeout,
    /// The connection closed before completion.
    Disconnected,
    /// The session is no longer authorized.
    Unauthorized,
}

/// Native ConnectionStatus; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native CloseReason; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum CloseReason {
    /// The session has stopped.
    Stopped,
    /// The session is no longer authorized.
    Unauthorized,
    /// State could not be recovered within the reset budget.
    Corrupt,
}

/// Native CloseCause; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native AttrValue; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native PeerPresence; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct PeerPresence {
    /// Presence entry key.
    pub key: String,
    /// Application-defined presence payload.
    pub value: NativeValue,
}

/// Native WalOwner; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum WalOwner {
    /// A row written by a current-format session.
    Session(SessionId),
    /// A row without a session owner from an older client.
    Legacy,
}

/// Native PeerRange; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum PeerRange {
    /// Excludes both current and legacy AI reservations.
    User,
    /// Includes only the current AI reservation.
    Ai,
}

/// Native SeedKind; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum SeedKind {
    /// Host-provided optimistic initial bytes.
    Optimistic,
    /// Snapshot loaded from local durable storage.
    Local,
    /// Host-provided cached remote snapshot.
    CachedS3,
    /// Fresh snapshot received from the sync service.
    Remote,
}

/// Native ContainerPath; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct ContainerPath {
    /// Loro root name.
    pub root: String,
    /// Traversal from that root.
    pub steps: Vec<PathStep>,
}

/// Native PathStep; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum PathStep {
    /// A native map entry.
    Key(String),
    /// A native list position.
    Index(u32),
    /// A child container's stable identity within the current sequence.
    Id(ContainerId),
}

/// Native ContainerKind; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum ContainerKind {
    /// Native map.
    Map,
    /// Native list.
    List,
    /// Native movable list.
    MovableList,
    /// Native text, addressed in UTF-16.
    Text,
}

/// Native DocOp; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum DocOp {
    /// Insert or replace a map entry.
    MapSet {
        /// Target map.
        map: ContainerPath,
        /// Entry name.
        key: String,
        /// New value.
        value: DocValue,
    },
    /// Remove a map entry, idempotently.
    MapDelete {
        /// Target map.
        map: ContainerPath,
        /// Entry name.
        key: String,
    },
    /// Insert into a native list or movable list.
    ListInsert {
        /// Target sequence.
        list: ContainerPath,
        /// Insertion position.
        index: u32,
        /// Inserted value.
        value: DocValue,
    },
    /// Delete a range from a native list or movable list.
    ListDelete {
        /// Target sequence.
        list: ContainerPath,
        /// First deleted position.
        index: u32,
        /// Number of values.
        len: u32,
    },
    /// Move a native movable-list value.
    MovableListMove {
        /// Target sequence.
        list: ContainerPath,
        /// Current position.
        from: u32,
        /// Destination in the final sequence.
        to: u32,
    },
    /// Replace one movable-list value.
    MovableListSet {
        /// Target sequence.
        list: ContainerPath,
        /// Position to replace.
        index: u32,
        /// New value.
        value: DocValue,
    },
    /// Replace a UTF-16-addressed text region.
    TextSplice {
        /// Target text.
        text: ContainerPath,
        /// First code unit.
        index: lexical_model::Utf16Offset,
        /// Number of deleted code units.
        delete: u32,
        /// Inserted string.
        insert: String,
    },
}

/// Native SaveState boundary.
#[uniffi::remote(Enum)]
pub enum SaveState {
    /// All changes are durably delivered with no pending or parked work.
    Saved,
    /// Durability or acknowledgement work is in progress.
    Saving,
    /// A retained condition prevents a saved state.
    Unsaved(UnsavedReason),
}

/// Native UnsavedReason boundary.
#[uniffi::remote(Enum)]
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

/// Native CommentMarkRequest boundary.
#[uniffi::remote(Record)]
pub struct CommentMarkRequest {
    /// Host request correlation key.
    pub request: RequestId,
    /// Stable annotation identity.
    pub mark_id: String,
    /// Add a selected range or remove the mark everywhere.
    pub action: CommentAction,
}

/// Native CommentAction boundary.
#[uniffi::remote(Enum)]
pub enum CommentAction {
    /// Wrap text only if both durable cursors still resolve to the expected text.
    Add {
        /// Durable selection start.
        anchor: NativeCursor,
        /// Durable selection end.
        focus: NativeCursor,
        /// Exact text expected under the selected range.
        text: String,
    },
    /// Remove this id from marks, unwrapping marks with no remaining ids.
    Remove,
}
