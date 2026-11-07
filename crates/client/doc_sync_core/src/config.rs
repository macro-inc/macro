use crate::*;

/// Host-supplied configuration for one document session.
#[derive(Clone, Debug)]
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

/// How a session reaches the sync service.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportKind {
    /// One socket to `{SYNC_SERVICE_HOSTS.ws}/document/{doc}/connect?token=…`.
    Direct,
    /// A route on the page's shared DSS `/sync/ws` router socket, owned by `RouterCore`.
    Routed,
    /// No live transport. ai-editing-worker's non-propagating sessions and tests
    /// (`createNoopLiveSyncSource`). A flush replies `Drained` immediately.
    None,
}

/// Whether durable storage effects are emitted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Persistence {
    /// Storage effects are emitted: IndexedDB or Turso.
    Durable,
    /// The WAL lives in memory only (`InMemoryWALStore`). No storage effects at all.
    Memory,
}

/// Effective document capabilities at the session boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Document edits and comment marks are permitted.
    Edit,
    /// Only comment marks are permitted.
    CommentOnly,
    /// Document mutations are prohibited.
    Read,
}

/// Monotonic deadlines for outstanding operations.
#[derive(Clone, Copy, Debug)]
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

/// Ping cadence and missed-pong budget.
#[derive(Clone, Copy, Debug)]
pub struct HeartbeatPolicy {
    /// Interval between scheduled pings.
    pub interval: Millis,
    /// Time allowed before the operation expires.
    pub timeout: Millis,
    /// Number of missed pongs tolerated.
    pub max_missed: u8,
} // 10_000, 5_000, 2

/// Delay before retry n (1-based) = base * 2^min(n, max_exponent). 500 ms … 8 s.
#[derive(Clone, Copy, Debug)]
pub struct BackoffPolicy {
    /// Base delay before exponential backoff.
    pub base: Millis,
    /// Cap on the retry exponent.
    pub max_exponent: u8,
    /// Maximum reconnect attempts before giving up.
    pub max_retries: u32,
} // 250, 5, 20

/// Bounded retry policy for convergence.
#[derive(Clone, Copy, Debug)]
pub struct ConvergePolicy {
    /// Maximum convergence attempts.
    pub max_attempts: u8,
    /// Delay between convergence attempts.
    pub retry_delay: Millis,
} // 3, 2_000

/// Batching, retention, and retry policy for local changes.
#[derive(Clone, Copy, Debug)]
pub struct WalPolicy {
    /// Local changes are exported and appended at most once per window. This is the knob
    /// that keeps typing at one wasm call per keystroke.
    pub coalesce: Millis, // 25
    /// Retention duration for undelivered orphan rows.
    pub ttl: Millis, // 7 days; undelivered entries older than this are dropped on load
    /// Minimum age before an unacknowledged update is retried.
    pub retry_unacked_after: Millis, // 5_000; matches today's 5 s snapshot-tick retry cadence
}

/// Expiry and refresh settings for ephemeral presence.
#[derive(Clone, Debug)]
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

/// Bounds the reset loop that today repeats on every bad import. New behaviour. Counts
/// **started** resets (I-3 step 0), successful or not.
/// Counts only `Loro`/`Projection` failures; an `Outdated` rebase (I-2') never charges it.
#[derive(Clone, Copy, Debug)]
pub struct ResetBudget {
    /// Maximum resets in the rolling window.
    pub max: u8,
    /// Rolling reset accounting duration.
    pub window: Millis,
} // 3 per 60_000

/// User identity and presentation chosen by the host, never generated by the core.
#[derive(Clone, Debug)]
pub struct PresenceUser {
    /// Opaque user identity, absent for anonymous presence.
    pub user_id: Option<macro_user_id::user_id::MacroUserIdStr<'static>>,
    /// Presence palette value chosen by the host.
    pub color: PaletteColor,
}
/// A color from the shared collaboration cursor palette.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
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
/// Key used to publish presence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PresenceKeyMode {
    /// Use the document peer id as the presence key.
    Peer,
    /// Use the supplied stable presence key.
    Fixed(String),
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            initial_sync: Millis(10_000),
            ack: Millis(5_000),
            snapshot: Millis(10_000),
            request_since: Millis(10_000),
            connect: Millis(15_000),
            storage: Millis(10_000),
        }
    }
}

impl Default for HeartbeatPolicy {
    fn default() -> Self {
        Self {
            interval: Millis(10_000),
            timeout: Millis(5_000),
            max_missed: 2,
        }
    }
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            base: Millis(250),
            max_exponent: 5,
            max_retries: 20,
        }
    }
}

impl Default for ConvergePolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            retry_delay: Millis(2_000),
        }
    }
}

impl Default for WalPolicy {
    fn default() -> Self {
        Self {
            coalesce: Millis(25),
            ttl: Millis(7 * 24 * 60 * 60 * 1_000),
            retry_unacked_after: Millis(5_000),
        }
    }
}

impl Default for ResetBudget {
    fn default() -> Self {
        Self {
            max: 3,
            window: Millis(60_000),
        }
    }
}
