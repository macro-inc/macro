use crate::*;

/// One input delivered with host-supplied clocks.
pub enum SyncInput {
    /// Begin loading local state and connecting. Idempotent.
    Start,
    /// Graceful stop: run the W-1 append, clear local presence, push it, close. Terminal.
    /// Replies `Reply::Stopped` only after that append's `Done` (W-1 terminal rule).
    Stop(RequestId),
    /// A seed the host obtained: optimistic bytes or the S3 cache. `Remote` seeds come from
    /// `RemoteInitialSync` and `Local` seeds come from `Storage(Loaded)`; both are internal.
    Seed {
        /// Origin or operation kind.
        kind: SeedKind,
        /// Serialized initial snapshot bytes.
        snapshot: Vec<u8>,
    },
    /// The session committed local Loro ops. Cheap: it sets a deadline only.
    LocalChanged,
    /// Replace or clear the local presence value.
    SetPresence(Option<loro::LoroValue>),
    /// Request or report delivery of outstanding changes.
    Flush(RequestId),
    /// A comment-mark update built on a forked doc. Never enters the WAL (§2.5).
    PublishComment {
        /// Host request correlation identifier.
        request: RequestId,
        /// Encoded Loro update bytes.
        update: Vec<u8>,
    },
    /// Ask the server for a fresh shallow snapshot (comment staging, explicit reset).
    RequestSnapshot(RequestId),
    /// Request replacement with a fresh server snapshot.
    Reset,
    /// Durable storage operation or completion.
    Storage(StorageEvent),
    /// Authorization fetch completion.
    Token(TokenEvent),
    /// Physical transport event.
    Socket {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// Event carried by this input.
        event: SocketEvent,
    },
    /// Routed transport: produced by `RouterCore`, never by the host directly.
    Route(RouteEvent),
    /// Bytes received from a co-located session.
    Chatter(ChatterMessage),
    /// Host lifecycle or network signal.
    Host(HostSignal),
    /// Current account and capability update.
    Authorization(AuthorizationState),
    /// The host's single timer fired. The core checks every deadline ≤ `now`.
    Tick,
}

/// A transport event for one connection attempt.
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
// A reassembly or bebop decode error on `Frame` emits `ws.message.error{stage}` telemetry and
// `SocketClose{ProtocolError}`, then reconnects through backoff. It never reaches I-2 (no
// reset). An unknown `FromRemote` discriminator is dropped with telemetry (≡ TS, S5 §3.1).
// A `RemoteInitialSync` while already `Synced` (S6 A7 sends one to every socket after
// `/initialize`) is handled as a reconnect: re-register, converge; its snapshot is never imported.

/// `access` is decoded by the executor from the token's claims, unverified, for gating only
/// (W-6). It is the access the server will fix for that connection.
pub enum TokenEvent {
    /// A permission token was fetched successfully.
    Fetched {
        /// Authorization attempt correlation counter.
        attempt: u32,
        /// Opaque permission token; never include it in telemetry.
        token: SyncToken,
        /// Effective write capability.
        access: WriteAccess,
    },
    /// The attempt failed.
    Failed {
        /// Authorization attempt correlation counter.
        attempt: u32,
    },
}
/// Write capabilities fixed by the server for a connection.
pub enum WriteAccess {
    /// All document writes are permitted.
    Full,
    /// Only comment-mark updates are permitted.
    CommentMarks,
    /// No write capability or no live transport.
    None,
}

/// Network and lifecycle notifications from the host.
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
// `Hidden`, `PageHide`, `Stop` and every entry into `Stopped`/`Closed(_)` first run the W-1
// append (and the P-2 presence send). The IndexedDB adapter calls `tx.commit()` explicitly on
// appends issued from `Hidden`/`PageHide`/`Stop`.

/// guarded-source.ts and authorization.ts, as values instead of callbacks. `can_comment` gates
/// `PublishComment` (§2.5); `can_write` gates pushes and the effective access (W-6):
/// `can_write: false, can_comment: true` downgrades to `CommentOnly`, otherwise to `Read`.
pub struct AuthorizationState {
    /// Whether this is still the active signed-in account.
    pub current: bool,
    /// Whether current authorization permits document writes.
    pub can_write: bool,
    /// Whether current authorization permits comment marks.
    pub can_comment: bool,
}

/// Same JS shape as chatter.ts on the BroadcastChannel `macro-loro-{doc}`, so new and old
/// bundles in the same browser still gossip. `Closing` is new and old tabs ignore it. Chatter
/// carries no user, so a session ignores chatter `Update` while its `user` differs from the
/// profile's current signed-in user (read from the storage the executor reads for O-2).
pub enum ChatterMessage {
    /// Encoded document update from another local session.
    Update(Vec<u8>),
    /// Encoded ephemeral presence update.
    Awareness(Vec<u8>),
    /// A local session is releasing its lease.
    Closing(SessionId),
}

/// Router events are scoped to a physical route subscription generation.
#[derive(Clone, Debug)]
pub enum RouteEvent {
    /// A routed subscription became active.
    Subscribed {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
    },
    /// Frame.
    Frame {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// One framed binary protocol message.
        frame: Vec<u8>,
    },
    /// The connection is permanently closed or reports a close event.
    Closed {
        /// Connection generation; stale events are ignored.
        conn: ConnId,
        /// Transport close status code.
        code: u16,
    },
}
