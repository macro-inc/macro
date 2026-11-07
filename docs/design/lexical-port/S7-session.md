# S7 — Document session: the sans-IO sync core, its composition, and the host wrappers

Revision: R2 (audit R1-C resolutions, then audit R2-3 and the sync items of R2-4 applied; see
"R1 resolutions" and "R2 resolutions" at the end), plus the R2.1 consistency edits.

Status: spec, nothing built. Read with `../SCOPE.md` (§3 boundary, §3.4 typing budget) and
the sibling specs for `lexical_model` (`EditorCore`, `Commit`, `Diff`), `lexical_loro`
(`LoroProjection`) and `sync_server_core`. Where this spec needs something from a sibling it
says so under **Needs from siblings**.

Decisions taken as given (established design):

- `lexical_model` is sans-IO and has no Loro inside.
- `lexical_loro` sits beside it. M1 is the pure `snapshot` fn. M2 is the live
  `LoroProjection`, owned by **S11 (`S11-loro-projection.md`)**: every projection signature this
  spec calls (`local_commit`, `remote`, `cursor`/`point`, the `NodeKey ↔ ContainerID` map) is
  normative there, not here.
- The **whole** client sync core moves to Rust as a sans-IO state machine (`doc_sync_core`):
  WAL, convergence, pending imports, reset, snapshots, presence, the connection machine with
  heartbeat and backoff, and bebop encode/decode via `crates/sync_protocol` (S6).
- `document_session` owns the `LoroDoc` and wires `EditorCore`, `LoroProjection` and
  `SyncCore` together.
- There is one cdylib for the web, `document_session_wasm`, and `document_session_ffi` for
  iOS and Android. JS only executes I/O effects and applies the view `Diff`.
- **No callbacks from Rust into JS.**
- Typing costs one wasm call per keystroke. The WAL write, the update send **and the presence
  send** are coalesced by one timer (W-1, P-2).

This spec supersedes SCOPE §3.1's "the sync engine stays JS on the web throughout", and SCOPE
§5's milestone split for the sync work:

| Milestone | Ships | Crates |
| --- | --- | --- |
| M1 | headless Rust editor and server routes; no client sync change | `lexical_model`, packages, `macro_document_model`, `lexical_loro` snapshot fns |
| M2 | projection + client sync core + session, tested natively and in the sim; nothing user-facing | `lexical_loro` projection (S11), `sync_doc_id`, `doc_sync_core`, `document_session`, `sync_sim` (S8), the S6 core |
| M3 | the web editor and its session swap together behind one feature flag (`document-session`); one cdylib, so no second Loro for the editor | `document_session_wasm`, the TS executor, §4.6 packaging |
| M4 | ai-editing-worker moves to the session (`Direct` + `Memory` + `PeerRange::Ai`) | `document_session_wasm` built for workerd (§4.6) |
| M5 | native-view editors on iOS/Android | `document_session_ffi`, `doc_store_turso` |

Conformance Tier B and the perf `core` cell use the dev-only `lexical_conformance_wasm` (S4),
never `document_session_wasm`.

**Loro version (WP-00, R2).** Rust has `loro = "1.16.2"` (root `Cargo.toml`, `Cargo.lock`); the
web catalog has `loro-crdt` `1.16.3` (root `package.json`); crates.io has no `loro 1.16.3`
(1.16.2 → 1.17.0). The port pins **one release, 1.16.2, on both sides**: WP-00 pins the catalog
to `loro-crdt` `1.16.2` exactly, after checking that 1.16.3's changes are JS-binding-only. If
1.16.3 carries a core fix, WP-00 instead bumps both sides to `1.17.1` before S6 C9a vendors
`awareness.rs`, and re-verifies every loro-internal line cited here (D-4) and in S6. Either way
the bump is one PR touching `Cargo.toml`/`Cargo.lock`, `bun.lock` and
`services/sync-service/package-lock.json` (whose `^1.13.7` range is pinned too). Later bumps
follow the same rule: Rust and catalog move in one PR, S8 §7.2 TS peers run the catalog
version, and a mixed-version check imports Rust-exported snapshots into that `loro-crdt`.

---

## 0. Crates

Paths follow S6 §2.1: flat `crates/` for shared crates, one level under the existing
`crates/client/` for client crates, no `client/sync/` nesting. The reorg phase-3 homes
(`crates/types/…`, `crates/testing/…`) are a later pure rename.

| Crate | Kind | Depends on | Contents |
| --- | --- | --- | --- |
| `crates/sync_doc_id` | lib | serde, thiserror, `document_id` (S13 §2; R2.1) | `SyncDocId`: the sync-service session key. It is a document id or a collab-surface id, and the transport is identical for both (`helpers.ts`). `impl From<DocumentId> for SyncDocId` (S13 §3.2). `sync_doc_id` depends on `document_id`, never the reverse. |
| `crates/sync_protocol` | lib | bebop, thiserror; feature `presence`: loro, serde, postcard | Owned by S6 (C1 moves `services/sync-service/bebop-schema` here). Rust types generated from `crates/sync_protocol/bebop/schema.bop` (`FromPeer`, `FromRemote`, `ToRouter`, `FromRouter`), owned (`Vec<u8>`) decode, framing (`MAX_CHUNK_SIZE = 900_000`, `into_frames`, `Reassembler`), the heartbeat text constants `PING = "ping"` / `PONG = "pong"`, `time::{UnixMillis, WallDuration}`, and `presence::EphemeralStore` (clock-injected, the one presence store for server and client). **One generator, one schema.** |
| `crates/client/doc_sync_core` | lib, wasm-safe | loro, sync_protocol, sync_doc_id, indexmap, thiserror, rootcause | `SyncCore`, `RouterCore`, `PresenceStore` (a thin wrapper over `sync_protocol::presence`), WAL bookkeeping. **No I/O, no clock reads, no randomness.** |
| `crates/client/document_session` | lib, wasm-safe | doc_sync_core, lexical_model, lexical_loro, macro_document_model (`default-features = false`: no `composers`, so no `trigger_context`/workspace-hack in wasm32) | `DocumentSession<S: Surface>`, `EditorSurface`, `GenericSurface`, comment publication |
| `crates/client/document_session_wasm` | **the only shipped cdylib** | document_session, wasm-bindgen, bebop | the exported JS surface (§4); `abi/session.bop` (§4.2) |
| `crates/client/document_session_ffi` | staticlib/cdylib for mobile | document_session, uniffi, optional `doc_store_turso` | the uniffi surface (§5) |
| `crates/client/doc_store_turso` | lib | turso_core (as `cache-turso` uses it) | `NativeStoreExecutor` (S9 §5): executes `StorageOp` on Turso for native hosts |
| `crates/sync_sim` | dev-only | everything above + `sync_server_core`, `sync_server_sim` | S8 |

Layer rules from the reorg plan apply:

- `client/**` depends only on `types/**`, `client/**` and the explicit wasm-safe allowlist.
  Until phase 3, `sync_protocol`, `sync_doc_id` and `document_id` (S13 §0) are on that
  allowlist, and so is `macro_document_model` (which `document_session` needs); add all four
  when the client crates land, or the layer rule fails.
- The wasm crates are excluded from hakari. `crates/client/*` is a prefix glob in
  `traversal-exclude-globs`, so nested client crates need no entry; the flat `crates/sync_doc_id`
  needs an explicit `traversal-excludes` entry beside `sync_protocol`.
- WP-00 acceptance check, for every client crate: `cargo tree -p <crate> --target
  wasm32-unknown-unknown -i workspace-hack` finds nothing.
- `getrandom/wasm_js` is gated on wasm32.
- `#![deny(missing_docs)]` is on. Every crate gets an `AGENTS.md` and a `CLAUDE.md` symlink.
- `lexical_model_wasm` from SCOPE §2c is **folded into `document_session_wasm`**. A page runs
  two wasm modules only if they cannot share a `LoroDoc` (SCOPE risk "two Loro wasm
  instances"), and the editor core with no session is only a test configuration. The
  conformance shim (Tier B) links `document_session_wasm` too. It never opens a session.

Determinism rules, enforced in `doc_sync_core` and `document_session` and relied on by S8:

- **D-1.** No `std::time`, no `SystemTime`, no `Instant`. Time arrives in every input as
  `Now`.
- **D-2.** No randomness. Peer ids, session ids and the presence colour arrive in config.
  Message ids are derived as `"{session}:{counter}"`.
- **D-3.** No iteration over `std::collections::HashMap`/`HashSet` whose order can reach an
  output. Use `BTreeMap`, `IndexMap` or `Vec`. An ast-grep rule in `rules/ast-grep/`, scoped to
  `crates/client/doc_sync_core/**` and `crates/client/document_session/**`, enforces it (run by
  `just check`). Not a crate-level `clippy.toml`: clippy reads only the nearest file, so one
  would silently drop the root bans (CS-14 `std::env::var`, `sqlx::query*`). Loro's internal
  `FxHashMap` is deterministic.
- **D-4. Loro clock and randomness** (loro-internal 1.16.2). D-4 binds `doc_sync_core` and
  `document_session` only. Server snapshot functions (S3 §4.3.6 `raw_state_to_loro_snapshot`)
  keep JS's `set_record_timestamp(true)`; do not "fix" either side to match the other.
  - (a) Never enable `record_timestamp`. Commit timestamps are read at txn *start*
    (`oplog.rs:1139-1145` `get_timestamp_for_next_txn`) whenever it is on, and implicit commits
    (before export, import, checkout, and inside `UndoManager::undo`) would carry system time.
    Every user commit is `commit_with(CommitOptions::new().timestamp(now.wall_secs()))`;
    implicit commits carry 0.
  - (b) `LoroDoc::new` (`state.rs:467`), `fork` (`state.rs:495,533`) and `renew_peer_id`
    (`loro.rs:259`) draw `DefaultRandom`. Call `set_peer_id(peers.next())` immediately after
    `new()` or `fork()`, before any op. Never enable detached editing (it calls
    `renew_peer_id`, `loro.rs:206,1684,1706`).
  - (c) Never pass `UpdateOptions.timeout_ms`. Diff timeouts (`diff_impl.rs:128`) read the clock
    only when it is `Some`; `LoroText::update` without a timeout is clock-free and allowed.
  - (d) `UndoManager` has `merge_interval = 0`, with grouping driven explicitly by
    `EditorCore`'s history heuristics through `group_start`/`group_end`. Its checkpoint clock read
    (`undo.rs:558`) is then benign unless the wall clock steps backwards.
  - (e) Presence goes through `sync_protocol::presence::EphemeralStore` with `now.wall`.

  S8's determinism guard is the backstop, but a deterministic misuse (S6 Q9's real-time store in
  a virtual-time sim) passes the guard, so these rules are reviewed, not just tested.

---

## 1. `doc_sync_core`

### 1.1 Values

```rust
/// Monotonic milliseconds since the session was created. Never decreases.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Millis(pub u64);

/// Wall-clock Unix milliseconds. Only for WAL `created_at`, TTL, presence timestamps and Loro
/// commit timestamps. The same type the server uses (S6 §2.3).
pub use sync_protocol::time::UnixMillis; // `pub struct UnixMillis(pub i64)`

/// A duration on the wall scale (presence timeouts, TTL). Same crate and type as S6 `RoomConfig`.
pub use sync_protocol::time::WallDuration; // `pub struct WallDuration(pub i64)`

/// Both clocks, read once by the host per input.
#[derive(Clone, Copy, Debug)]
pub struct Now { pub mono: Millis, pub wall: UnixMillis }

/// One live session of one document in one tab or process. It is the WAL owner and the
/// prefix of every update message id. UUID v7, generated by the host (D-2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SessionId(pub uuid::Uuid);

/// Position in one owner's WAL. Strictly increasing per (doc, owner), starting at 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WalSeq(pub u64);

/// The signed-in Macro user an open runs as: an opaque user id, never an email (observability
/// rule). WAL rows carry it so a profile shared by two users never pushes one user's rows under
/// the other's token (O-2).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UserKey(pub String);

/// Who wrote a WAL row. `Legacy` is a row with no `owner` field: written by a pre-Rust bundle
/// into the same `macro-document-wal` store.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum WalOwner { Session(SessionId), Legacy }

/// One physical connection attempt. Events tagged with an old `ConnId` are ignored. This
/// replaces `connectionGeneration` (websocket.ts) and `lifecycleGeneration` (engine.ts).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConnId(pub u32);

/// Correlates a storage effect with its completion. `u32`: it is I/O slot `a` (§4.2) and
/// `storageDone(op: number)`; a session never issues 2³² storage ops.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct StorageOpId(pub u32);

/// Correlates a host request (flush, comment publication) with its `Reply`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RequestId(pub u32);

/// `PeerUpdate.id` / `RemoteUpdateAck.id`. Format `"{session}:{n}"`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UpdateId(String);

/// A DocumentPermissionToken. `Debug` prints `SyncToken(<redacted>)`. Never logged.
#[derive(Clone, PartialEq, Eq)]
pub struct SyncToken(String);
```

### 1.2 Config

```rust
pub struct SyncConfig {
    pub doc: SyncDocId,
    pub session: SessionId,
    pub user: UserKey,
    pub transport: TransportKind,
    pub persistence: Persistence,
    pub access: Access,
    /// The token the page already fetched, used for the first connect only (helpers.ts
    /// `initialUrl`). `None` for a cached open: every connect is freshly authorized and
    /// there is no stale-token fallback.
    pub initial_token: Option<SyncToken>,
    /// Joins the sync-service spans to the opener's trace (`?traceparent=`).
    pub traceparent: Option<String>,
    pub timeouts: Timeouts,
    pub heartbeat: HeartbeatPolicy,
    pub backoff: BackoffPolicy,
    pub converge: ConvergePolicy,
    pub wal: WalPolicy,
    /// `Some(5_000)` for every durable surface today (engine.ts `SNAPSHOT_INTERVAL_MS`).
    pub snapshot_interval: Option<Millis>,
    pub presence: PresencePolicy,
    /// Gossip updates and presence to co-located sessions (BroadcastChannel). Requires
    /// `Persistence::Durable` (W-10); `new` rejects `chatter` with `Memory`.
    pub chatter: bool,
    pub reset_budget: ResetBudget,
}

pub enum TransportKind {
    /// One socket to `{SYNC_SERVICE_HOSTS.ws}/document/{doc}/connect?token=…`.
    Direct,
    /// A route on the page's shared DSS `/sync/ws` router socket, owned by `RouterCore`.
    Routed,
    /// No live transport. ai-editing-worker's non-propagating sessions and tests
    /// (`createNoopLiveSyncSource`). A flush replies `Drained` immediately.
    None,
}

pub enum Persistence {
    /// Storage effects are emitted: IndexedDB or Turso.
    Durable,
    /// The WAL lives in memory only (`InMemoryWALStore`). No storage effects at all.
    Memory,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Access { Edit, CommentOnly, Read }

pub struct Timeouts {
    pub initial_sync: Millis,   // 10_000
    pub ack: Millis,            //  5_000; server acks only after durable store, its budget is 4.5 s
    pub snapshot: Millis,       // 10_000
    pub request_since: Millis,  // 10_000
    pub connect: Millis,        // 15_000; new: a socket stuck CONNECTING is abandoned
    pub storage: Millis,        // 10_000; bounds `Flush` waiting on `Writing` entries (§2.4)
}

pub struct HeartbeatPolicy { pub interval: Millis, pub timeout: Millis, pub max_missed: u8 } // 10_000, 5_000, 2

/// Delay before retry n (1-based) = base * 2^min(n, max_exponent). 500 ms … 8 s.
pub struct BackoffPolicy { pub base: Millis, pub max_exponent: u8, pub max_retries: u32 } // 250, 5, 20

pub struct ConvergePolicy { pub max_attempts: u8, pub retry_delay: Millis } // 3, 2_000

pub struct WalPolicy {
    /// Local changes are exported and appended at most once per window. This is the knob
    /// that keeps typing at one wasm call per keystroke.
    pub coalesce: Millis,             // 25
    pub ttl: Millis,                  // 7 days; undelivered entries older than this are dropped on load
    pub retry_unacked_after: Millis,  // 5_000; matches today's 5 s snapshot-tick retry cadence
}

pub struct PresencePolicy {
    /// A duration compared against **wall** time (`UnixMillis`), because peers stamp entries
    /// with their own wall clock and the receiver drops `now.wall - timestamp > timeout`.
    pub timeout: WallDuration,    // 10_000 (markdown passes 5_000)
    /// Re-send an unchanged local presence this often while connected (forms and
    /// spreadsheets: 3_000). `None` for markdown.
    pub refresh: Option<Millis>,
    pub user: PresenceUser,       // { user_id: Option<MacroUserId>, color: PaletteColor }
    /// `Peer` (the local peer id string, every browser/native editor) or `Fixed(key)`: the
    /// ai-editing-worker's UUID key with the `(AI)` label, `refresh = Some(2_000)` sending
    /// `encode_all`, and a 700 ms linger before `Stop` clears it (`ai-peer.ts`, F21.4).
    pub key: PresenceKeyMode,
}

/// Bounds the reset loop that today repeats on every bad import. New behaviour. Counts
/// **started** resets (I-3 step 0), successful or not.
/// Counts only `Loro`/`Projection` failures; an `Outdated` rebase (I-2') never charges it.
pub struct ResetBudget { pub max: u8, pub window: Millis } // 3 per 60_000
```

### 1.3 The document port

`SyncCore` never owns or imports into a `LoroDoc` itself. Every import has to go through the
projection so the editor sees `NodeChange`s. `document_session` therefore lends the core a
`SyncDoc`. These are plain Rust trait calls inside one `handle`, not callbacks across the
wasm boundary.

```rust
pub trait SyncDoc {
    /// The current doc instance's peer. A fresh peer id per LoroDoc instance (cold start,
    /// reset), never reused (§1.8).
    fn peer_id(&self) -> loro::PeerID;

    fn oplog_vv(&self) -> loro::VersionVector;

    /// Import remote bytes. For an editor, this runs the projection and queues the
    /// resulting view diff inside the session.
    fn import_remote(&mut self, bytes: &[u8], origin: ImportOrigin) -> Result<Imported, ImportFailure>;

    /// Only the current peer's ops in `since..oplog_vv`, as one `updates-in-range` export.
    /// `Ok(None)` when there is nothing new. Replaces `getUpdateSince` (manager.ts).
    fn export_local(&self, since: &loro::VersionVector) -> Result<Option<Vec<u8>>, ExportFailure>;

    /// `shallow-snapshot` at `at`: the frontiers of the last completed convergence (a
    /// server-confirmed base, S-1'), never `oplog_frontiers()` (Δ from engine.ts
    /// `persistSnapshot`). Ops after `at` stay in the snapshot as history above the root, so a
    /// concurrent remote op made after the base imports without a rebase.
    fn export_shallow_snapshot(&self, at: &loro::Frontiers) -> Result<Vec<u8>, ExportFailure>;

    /// Import `bytes` into a throwaway `LoroDoc` seeded from `snapshot`, peer from the supply
    /// and never committed. Used only by the W-11 poison proof.
    fn probe_import(&mut self, snapshot: &[u8], bytes: &[u8]) -> Result<Imported, ImportFailure>;

    /// Seed an empty doc. First-wins is decided by the core, not here.
    fn seed(&mut self, snapshot: &[u8], kind: SeedKind) -> Result<(), ImportFailure>;

    /// Throw this instance away and load `snapshot` into a new one with `new_peer`, set by
    /// `set_peer_id` right after `LoroDoc::new()` and before the import (D-4b).
    /// The snapshot must be self-contained: `pending` is an error (manager.ts `reset`).
    fn replace(&mut self, snapshot: &[u8], new_peer: loro::PeerID) -> Result<(), ImportFailure>;
}

/// `new_ops`: the import grew the oplog vv (W-10.2 stores chatter only then).
pub struct Imported { pub changed: bool, pub pending: bool, pub new_ops: bool }

pub enum ImportOrigin { Live, Chatter, Catchup, WalReplay, CommentEcho }

pub enum SeedKind { Optimistic, Local, CachedS3, Remote }

#[derive(Debug, thiserror::Error)]
pub enum ImportFailure {
    #[error("loro rejected the update")] Loro(#[source] loro::LoroError),
    /// Loro `ImportUpdatesThatDependsOnOutdatedVersion`: the bytes depend on ops below this
    /// doc's shallow root. Not corruption: it starts a rebase (I-2'), never a budgeted reset.
    #[error("update depends on history below the shallow root")] Outdated,
    #[error("projection failed")] Projection(#[source] rootcause::Report),
}
```

### 1.4 Inputs

```rust
pub enum SyncInput {
    /// Begin loading local state and connecting. Idempotent.
    Start,
    /// Graceful stop: run the W-1 append, clear local presence, push it, close. Terminal.
    /// Replies `Reply::Stopped` only after that append's `Done` (W-1 terminal rule).
    Stop(RequestId),
    /// A seed the host obtained: optimistic bytes or the S3 cache. `Remote` seeds come from
    /// `RemoteInitialSync` and `Local` seeds come from `Storage(Loaded)`; both are internal.
    Seed { kind: SeedKind, snapshot: Vec<u8> },
    /// The session committed local Loro ops. Cheap: it sets a deadline only.
    LocalChanged,
    SetPresence(Option<loro::LoroValue>),
    Flush(RequestId),
    /// A comment-mark update built on a forked doc. Never enters the WAL (§2.5).
    PublishComment { request: RequestId, update: Vec<u8> },
    /// Ask the server for a fresh shallow snapshot (comment staging, explicit reset).
    RequestSnapshot(RequestId),
    Reset,
    Storage(StorageEvent),
    Token(TokenEvent),
    Socket { conn: ConnId, event: SocketEvent },
    /// Routed transport: produced by `RouterCore`, never by the host directly.
    Route(RouteEvent),
    Chatter(ChatterMessage),
    Host(HostSignal),
    Authorization(AuthorizationState),
    /// The host's single timer fired. The core checks every deadline ≤ `now`.
    Tick,
}

pub enum SocketEvent {
    Opened,
    /// One binary wire frame (`[is_final, …chunk]`). Reassembled per `ConnId` in Rust.
    Frame(Vec<u8>),
    /// A text message. Only `"pong"` is meaningful.
    Text(String),
    /// The platform's error, then close. Tauri read errors arrive as `Closed { code: 1006 }`.
    Closed { code: u16, clean: bool },
}
// A reassembly or bebop decode error on `Frame` emits `ws.message.error{stage}` telemetry and
// `SocketClose{ProtocolError}`, then reconnects through backoff. It never reaches I-2 (no
// reset). An unknown `FromRemote` discriminator is dropped with telemetry (≡ TS, S5 §3.1).
// A `RemoteInitialSync` while already `Synced` (S6 A7 sends one to every socket after
// `/initialize`) is handled as a reconnect: re-register, converge; its snapshot is never imported.

/// `access` is decoded by the executor from the token's claims, unverified, for gating only
/// (W-6). It is the access the server will fix for that connection.
pub enum TokenEvent { Fetched { attempt: u32, token: SyncToken, access: WriteAccess }, Failed { attempt: u32 } }
pub enum WriteAccess { Full, CommentMarks, None }

pub enum HostSignal {
    /// `window` `online` or `visibilitychange → visible` (source.ts). Reconnect only if down.
    /// Every host signal carries a fresh `Now.wall` (wasm `host(signal, now, wall)`), which
    /// re-bases the session's wall clock after a suspend (§4.1).
    Online, Visible,
    /// `visibilitychange → hidden` or `pagehide`: flush the coalesced WAL write now instead
    /// of waiting out the window, and post `ChatterMessage::Closing` on pagehide.
    Hidden, PageHide,
}
// `Hidden`, `PageHide`, `Stop` and every entry into `Stopped`/`Closed(_)` first run the W-1
// append (and the P-2 presence send). The IndexedDB adapter calls `tx.commit()` explicitly on
// appends issued from `Hidden`/`PageHide`/`Stop`.

/// guarded-source.ts and authorization.ts, as values instead of callbacks. `can_comment` gates
/// `PublishComment` (§2.5); `can_write` gates pushes and the effective access (W-6):
/// `can_write: false, can_comment: true` downgrades to `CommentOnly`, otherwise to `Read`.
pub struct AuthorizationState { pub current: bool, pub can_write: bool, pub can_comment: bool }

/// Same JS shape as chatter.ts on the BroadcastChannel `macro-loro-{doc}`, so new and old
/// bundles in the same browser still gossip. `Closing` is new and old tabs ignore it. Chatter
carries no user, so a session ignores chatter `Update` while its `user` differs from the
profile's current signed-in user (read from the storage the executor reads for O-2).
pub enum ChatterMessage { Update(Vec<u8>), Awareness(Vec<u8>), Closing(SessionId) }
```

### 1.5 Outputs

```rust
#[derive(Default)]
pub struct SyncOutput {
    pub io: Vec<IoEffect>,
    pub events: Vec<SyncEvent>,
    /// The earliest deadline the core holds. The host keeps exactly one timer.
    pub wake_at: Option<Millis>,
}

pub enum IoEffect {
    /// `doc` is the session's doc for `Direct`, and the route's doc from `RouterCore`.
    FetchToken { attempt: u32, doc: SyncDocId },
    SocketConnect { conn: ConnId, doc: SyncDocId, token: SyncToken, traceparent: Option<String> },
    /// One already-framed binary message. A large `FromPeer` yields several in order.
    SocketSend { conn: ConnId, frame: Vec<u8> },
    SocketPing { conn: ConnId },
    SocketClose { conn: ConnId, code: u16, reason: CloseCause },
    Storage { id: StorageOpId, op: StorageOp },
    ChatterPost(ChatterMessage),
    Telemetry(TelemetryRecord),
}

pub enum SyncEvent {
    Status(SyncStatus),
    Presence(Vec<PeerPresence>),
    Reply { request: RequestId, reply: Reply },
    /// The doc was replaced (reset). The session re-initializes its surface.
    Replaced,
    /// A seed won. The session initializes its surface (editor init, §2.3).
    Seeded { kind: SeedKind, replayed_wal: u32 },
    /// The effective access changed (W-6: `Authorization{can_write}` flipped). The editor
    /// starts or stops rejecting mutations.
    AccessChanged(Access),
}

pub enum Reply {
    Flush(FlushReply),                         // Drained | NotDrained { undelivered: u32 } | Offline | ReadOnly
    Comment(CommentReply),                     // Accepted | NotAcked | Refused(CommentRefusal)
    Snapshot(Result<Vec<u8>, RequestFailure>), // RequestFailure: Timeout | Disconnected | Unauthorized
    /// `Stop` finished: the window was appended (or the append failed and was reported). The
    /// host drops the session only after this reply.
    Stopped,
}

pub struct SyncStatus {
    pub connection: ConnectionStatus, // Connecting | Connected | Disconnected | Offline (gave up) | Closed(CloseReason)
    pub save: SaveState,              // Saved | Saving | Unsaved(UnsavedReason::{Undelivered, Storage, ReadOnly, Poison, Gap, Rebasing})
    pub pending_import: bool,         // Loro holds ops waiting on missing dependencies
}
```

**`Saved` is earned, never assumed (R2).** `save = Saved` iff every own and foreign entry is
delivered, `append_due` is unset, no entry is `Writing`/`Unlogged`/parked (quarantined, gap,
`needs_rebase`), `health = Ok`, no rebase is pending, and `pending_import` is false. After a
poison reset (W-11), `Saved` additionally waits for the new peer's first ack. Any parked row
holds `Unsaved(Poison | Gap | ReadOnly | Rebasing)` for as long as it exists. The server's acks of
imports it holds pending (S6 A4) are made safe by S6 PR 6 and the R-7 rollout gate, not by
the client.

Parent rule for `TelemetryRecord`: a span parents on the span of the flow that caused it.
`doc.sync.catchup` for the first converge parents on the load span (as today, S5 §7.19); a
catch-up caused by a reconnect parents on that connection's `doc.sync.connect`; `edit.apply`
parents on the import that carried it; `doc.sync.reset` is a root linked to the failing
import's span.

`TelemetryRecord` covers spans that a trace would otherwise lose (observability rule). The
host maps each record onto `Telemetry.span` (web) or `tracing` (native). Span names are kept
from today: `doc.seed`, `doc.sync.catchup`, `edit.apply`, `wal.delivery_outage`, and the new
`doc.sync.reset` and `doc.sync.connect`. Attributes hold ids, sizes and outcomes only. They
never hold content. §4.7 lists every R2 span and event and their parents.

```rust
pub struct TelemetryRecord { pub span: SpanKey, pub kind: TelemetryKind, pub attrs: Vec<(&'static str, AttrValue)> }
pub enum TelemetryKind { Start { name: &'static str }, Event { name: &'static str }, End { outcome: &'static str, error: bool } }
```

### 1.6 Storage abstraction (IndexedDB or Turso)

This section is the **only** core-facing storage contract. S9's `NativeStoreExecutor` and the
IndexedDB adapter (§4.4) each execute exactly these ops, one method per `StorageOp`.

Rows are keyed `(doc, owner, seq)` and carry a per-row `delivered` flag, which is the durable
form on every store (it is what pre-Rust bundles read and write). The core keeps a derived
`delivered_through` per owner: the longest delivered prefix of that owner's seqs. One push is in
flight at a time and carries a contiguous run above `delivered_through` (W-3), so delivery is a
prefix, and `WalMarkDelivered{through}` sets the flags of every row ≤ `through` in one
transaction.

```rust
pub struct WalRecord {
    pub seq: WalSeq,
    pub created_at: UnixMillis,
    pub user: UserKey,
    /// Bytes this session imported from chatter and stores on behalf of their writer (W-10).
    /// `export_local` never re-exports them; they are delivered per W-10.5 and pruned like own
    /// rows, and never posted to chatter.
    pub foreign: bool,
    /// Parked as proven poison (W-11). Kept until TTL, never pushed, never deleted early.
    pub quarantined: bool,
    pub bytes: Vec<u8>,
}

/// A row as read back from the store.
pub struct StoredWalRecord { pub record: WalRecord, pub delivered: bool }

pub enum StorageOp {
    /// The snapshot, plus every orphaned owner's rows for `doc` (O-2) and, read-only, every
    /// live foreign owner's undelivered rows (`assist`, O-5). Rows of a different `user` are
    /// never returned (O-2).
    Load { doc: SyncDocId, owner: SessionId, user: UserKey },
    /// Re-read orphans and assist rows only (on every `Synced`, on `ChatterMessage::Closing`,
    /// and when convergence ends still pending).
    LoadOrphans { doc: SyncDocId, owner: SessionId, user: UserKey },
    /// Idempotent on `(doc, owner, seq)`: a row that already exists is left as is (SC-6).
    /// `retry` is true only on the re-emit after `Uncertain` (SC-3); only then does the IDB
    /// adapter scan for an existing row (§4.4).
    WalAppend { doc: SyncDocId, owner: SessionId, record: WalRecord, retry: bool },
    /// Set `delivered` on every row of `owner` with seq ≤ `through`, in one transaction.
    WalMarkDelivered { doc: SyncDocId, owner: SessionId, through: WalSeq },
    /// Delete own rows with seq ≤ `through`. Issued only after a snapshot covering them is
    /// durable and they are delivered (W-9).
    WalPrune { doc: SyncDocId, owner: SessionId, through: WalSeq },
    /// One transaction, conditional on each row's `owner == from`: rewrite `owner` to `to` and
    /// renumber `seq` from `first_seq` in place, for every row of `from` with
    /// `seq > covers_for(from)` or `!delivered`, preserving `delivered`, `created_at`, `user`
    /// and `foreign`; delete the rest of `from`'s rows (delivered and covered by the snapshot).
    /// `covers_for(from)` is the snapshot's `covers.seq` when `covers.owner == from`, else 0.
    /// Atomic for legacy rows too (no copy-then-delete).
    WalAdopt { doc: SyncDocId, from: WalOwner, to: SessionId, first_seq: WalSeq, covers: WalSeq },
    /// Drop `from`'s undelivered rows with `created_at < before` (TTL, W-7). `from` is an orphan,
    /// `Legacy`, or another user's owner (O-2: `Load` reports other users' expired rows for this
    /// op only), never a live owner.
    WalDropExpired { doc: SyncDocId, from: WalOwner, before: UnixMillis },
    /// Park one own row proven poison (W-11): set `quarantined = true`. Never a delete; the
    /// row stays until TTL (W-7) so nothing a user typed is removed by inference.
    WalQuarantine { doc: SyncDocId, owner: SessionId, seq: WalSeq },
    SnapshotSave { doc: SyncDocId, bytes: Vec<u8>, covers: Option<(SessionId, WalSeq)> },
    SnapshotDelete { doc: SyncDocId },
}

pub enum StorageEvent {
    Loaded { id: StorageOpId, result: Result<LocalState, StorageFailure> },
    Done { id: StorageOpId, result: Result<(), StorageFailure> },
    /// `WalAdopt` completion: how many rows moved. Adopted rows enter `entries` only now, and
    /// only that many (0 when another tab won).
    Adopted { id: StorageOpId, result: Result<u32, StorageFailure> },
}

pub struct LocalState {
    /// `None` also when the stored snapshot is empty (`byteLength == 0`, S5 §2.3
    /// `hasLocalSnapshot`): the executor maps `Some(empty)` to `None`.
    pub snapshot: Option<StoredSnapshot>,           // { bytes, covers: Option<(SessionId, WalSeq)> }
    /// Owners with no live lease (O-2), plus `Legacy`. Same `user` only.
    pub orphans: Vec<OrphanWal>,                    // { owner: WalOwner, records: Vec<StoredWalRecord> }
    /// Undelivered rows of live foreign owners (frozen or old tabs), read-only (O-5).
    pub assist: Vec<OrphanWal>,
}

pub enum StorageFailure {
    Unavailable,
    QuotaExceeded,
    Corrupt,
    /// The store can't tell whether the write committed (a Turso commit whose fsync result was
    /// lost, an IDB transaction aborted after `complete` was queued). Never triggers a wipe.
    Uncertain,
    Other,
}
```

Executor contract, which every adapter must meet. S8 `SimStorage` checks it, and so does a
conformance suite shared by the IndexedDB adapter and `doc_store_turso`.

- **SC-1.** A `Done(Ok)` / `Loaded(Ok)` means the write survives renderer or browser process
  death. A crash before the completion is delivered may lose it. Power loss and OS crashes are
  not covered on web: IndexedDB `durability: 'default'` is not fsynced (S9 §3).
- **SC-2.** Ops for one `doc` complete in issue order. Adapters serialize per doc, which
  replaces spreadsheet-session's `serializeSnapshotOperation`.
- **SC-3.** The core never retries an append after `Done(Err(_))`, except: after
  `Uncertain` it re-emits the same `WalAppend` (same `owner`, `seq`, bytes). The append is
  idempotent on `(doc, owner, seq)` (SC-6), so that is safe. The IndexedDB adapter keeps today's
  single retry after a proven rollback (`BrowserWALStore.append`, `RecoverableDatabase`); the
  core sees one completion.
- **SC-4.** `WalAdopt` is atomic and conditional on `owner == from`.
- **SC-5.** No adapter ever wipes the store automatically. Corruption is reported as `Corrupt`
  on the op that hit it; the core decides (S-2 deletes only a snapshot that fails to import).
- **SC-6.** `WalAppend` is idempotent on `(doc, owner, seq)`.
- **SC-7.** Snapshot eviction (an executor policy, S9 §5) never touches a doc with undelivered
  rows.
- **SC-8.** The WAL lives in its own database identity: never inside the GraphQL cache's
  `cache.turso` or its OPFS file.
- **SC-9 (web).** Every storage op waits until the session's Web Lock is granted
  (`navigator.locks.request` is async). The executor queues `Storage` effects until then.

Reference schema (Turso; write-once, never `ALTER` in place, upstream #7077). The IndexedDB
rows carry the same fields in the existing v1 store (§3.5):

```sql
CREATE TABLE wal_entry (doc TEXT NOT NULL, owner TEXT NOT NULL, seq INTEGER NOT NULL,
                        user TEXT NOT NULL, created_at INTEGER NOT NULL, foreign_row INTEGER NOT NULL,
                        delivered INTEGER NOT NULL DEFAULT 0, quarantined INTEGER NOT NULL DEFAULT 0, bytes BLOB NOT NULL,
                        PRIMARY KEY (doc, owner, seq)) STRICT;
CREATE INDEX wal_entry_expiry ON wal_entry (delivered, created_at);
CREATE TABLE snapshot  (doc TEXT PRIMARY KEY, bytes BLOB NOT NULL, covers_owner TEXT, covers_seq INTEGER,
                        saved_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL) STRICT;
CREATE TABLE meta      (key TEXT PRIMARY KEY, value BLOB NOT NULL) STRICT; -- format version, process_epoch
```

There is no lease table: native leases are an in-memory registry (O-1).

### 1.7 `SyncCore`

```rust
pub struct SyncCore {
    config: SyncConfig,
    phase: Phase,
    connection: Connection,
    wal: Wal,
    push: Push,
    convergence: Convergence,
    presence: PresenceStore,
    auth: AuthorizationState,
    /// `config.access`, downgraded to `Read` while `auth.can_write` is false (W-6).
    effective_access: Access,
    snapshot: SnapshotSchedule,
    flushes: Vec<(RequestId, Millis)>,
    requests: PendingRequests,        // snapshot and comment waiters, keyed by kind + deadline
    /// One FIFO per `ConnId` **and request kind** of outstanding `RequestSince`/`RequestSnapshot`,
    /// with tombstones for timed-out entries (C-2, I-1).
    replies: BTreeMap<(ConnId, RequestKind), VecDeque<Outstanding>>,
    /// The access the server fixed for each connection, from `TokenEvent::Fetched.access` (W-6).
    conn_access: BTreeMap<ConnId, WriteAccess>,
    /// Frontiers of the last completed convergence (S-1').
    confirmed_base: loro::Frontiers,
    rebase: RebaseState,              // Idle | Due { at: Millis } | InFlight { rerun: bool }
    /// Insertion-ordered; the current peer first. The server uses the *first registered* peer
    /// for blame (S6 M9c), so order matters (`indexmap::IndexSet`).
    registered_peers: IndexSet<loro::PeerID>,
    last_token: Option<SyncToken>,    // in memory only; fallback when a refresh fails
    allow_token_fallback: bool,       // = config.initial_token.is_some()
    ever_synced: bool,                // "reconnect" vs first connect (websocket.ts `_lastConnection`)
    next_conn: u32,
    next_update: u64,
    next_storage_op: u32,
}

impl SyncCore {
    pub fn new(config: SyncConfig, now: Now) -> Self;

    /// The only entry point. Clears and fills `out`, so the caller reuses buffers.
    pub fn handle(&mut self, now: Now, doc: &mut impl SyncDoc, input: SyncInput, out: &mut SyncOutput);

    pub fn status(&self) -> &SyncStatus;
    /// True when there is no in-flight push, no undelivered **unparked** WAL entry, no
    /// outstanding request, no pending import and no due rebase, and the connection is `Synced`.
    /// Parked entries are ignored: rows held while `effective_access != Edit`, quarantined rows
    /// (W-11), gap rows (W-2) and `needs_rebase` rows while offline. With `TransportKind::None`
    /// the connection clause is dropped. A terminal `Closed(_)` session is never idle; S8
    /// excludes it from quiescence and reports it instead. Used by S8 `Settle` and by `Flush`.
    pub fn is_idle(&self) -> bool;
    /// Why `is_idle` is false, for S8's `SettleTimedOut`.
    pub fn busy(&self) -> Option<BusyReason>; // PendingImport | Undelivered | InFlight | NotConnected | Rebasing
    /// Parked entries by reason, for reporting (S8 `RowsParked`). Never part of `is_idle`.
    pub fn parked(&self) -> Vec<(WalSeq, ParkReason)>; // ReadOnly | Poison | Gap | NeedsRebase
}

pub enum Phase {
    Created,
    /// Waiting for a seed. Optimistic, S3 and remote seeds race the local load (first wins).
    Loading { local: LocalLoad, seeded: Option<SeedKind>, reset_requested: bool },
    Running,
    Resetting(ResetPhase),
    Stopped,
}

pub enum LocalLoad { NotRequested, Requested(StorageOpId), Done, Failed { retry_at: Millis } }

pub enum ResetPhase {
    /// Deliver unsent edits first so the replacement snapshot holds them (engine.ts
    /// `flushUnsentEdits`). Ends on ack, failure, or deadline. Local edits still apply to the
    /// old doc in this phase and each one forces an immediate append (I-3 step 0).
    Flushing { deadline: Millis },
    AwaitingSnapshot { deadline: Millis },
}
```

#### Connection

```rust
pub enum Connection {
    Idle,
    /// Waiting for `TokenEvent` for `attempt`. Today's `connectPending`.
    Authorizing { conn: ConnId, attempt: u32 },
    /// `SocketConnect` issued. Abandoned after `timeouts.connect`.
    Connecting { conn: ConnId, attempt: u32, deadline: Millis },
    /// Socket open (or route subscribed), waiting for `RemoteInitialSync`. Past `deadline`
    /// the heartbeat starts anyway and a late initial sync is still accepted (source.ts:
    /// "an offline bootstrap can outlive the initial waiter").
    AwaitingInitialSync { conn: ConnId, deadline: Millis, heartbeat: Option<Heartbeat> },
    Synced { conn: ConnId, heartbeat: Heartbeat },
    /// Closed and a retry is scheduled.
    Backoff { attempt: u32, retry_at: Millis },
    /// `max_retries` spent. Revived by `Online`, `Visible`, `LocalChanged` or `Flush`.
    /// `LocalChanged`/`Flush` revive only `GaveUp`; during `Backoff` they leave the scheduled
    /// retry alone (F40, a Δ: today a guarded push cancels the retry and connects at once).
    GaveUp { attempts: u32 },
    Closed(CloseReason),
}

pub enum Heartbeat {
    Waiting { next_ping_at: Millis, missed: u8 },
    AwaitingPong { deadline: Millis, missed: u8 },
}

pub enum CloseReason { Stopped, Unauthorized, Corrupt }
pub enum CloseCause { NoHeartbeat, ConnectTimeout, Stopped, Unauthorized, Superseded, ProtocolError }
```

The transitions are the whole contract, so all of them are listed.

| From | Input | To | Effects |
| --- | --- | --- | --- |
| `Idle` / `Backoff` (due) / `GaveUp` (revived) | — | `Authorizing{attempt}` if a token is needed, else `Connecting` | `FetchToken`. The very first connect uses `initial_token` and skips the fetch. |
| `Authorizing` | `Token::Fetched` (same attempt) | `Connecting` | `SocketConnect{token}`, `last_token = token`, `conn_access[conn] = access` |
| `Authorizing` | `Token::Failed` | `Connecting` with `last_token` if `allow_token_fallback`, else `Backoff` | — |
| `Connecting` | `Opened` | `AwaitingInitialSync` | backoff reset: the next `Closed` schedules attempt 1 again. An accept-then-close loop therefore retries at 500 ms forever, as today (≡) |
| `Connecting` | deadline | `Backoff` | `SocketClose{ConnectTimeout}` |
| `AwaitingInitialSync` | `RemoteInitialSync` | `Synced` | see "on synced" below |
| `AwaitingInitialSync` | deadline | same, `heartbeat = Some(..)` | — |
| `Synced` | ping due (`Waiting.next_ping_at`) | `AwaitingPong{deadline: now + timeout}` | `SocketPing`. Pings run on a fixed cadence from entering `Synced`: `next_ping_at` advances by `interval` each time, independent of pongs (today's `setInterval`) |
| `Synced` | `Text("pong")` in either heartbeat state | `Waiting{next_ping_at: next cadence slot, missed: 0}` | — (any pong resets `missed`, even a late one) |
| `Synced` | pong deadline, `missed + 1 ≤ max_missed` | `Waiting{next_ping_at: next cadence slot, missed: missed + 1}` | — |
| `Synced` | pong deadline, `missed + 1 > max_missed` | `Backoff` | `SocketClose{1000, NoHeartbeat}`. With 10 s / 5 s / 2 this is ~35 s after the last pong (S5 §2.6) |
| any live | `Closed` (same conn) | `Backoff{attempt+1}`, or `GaveUp` past `max_retries` | cancel in-flight push, comment waiters and snapshot waiters (source.ts `cancelOnDisconnect`), then reset the reassembler |
| `Backoff`/`GaveUp` | `Online`/`Visible` | `Authorizing`/`Connecting` | no-op when already live or pending (`reconnectIfDisconnected`) |
| any live | `Closed{code: 1008}` (document deleted, surface revoked or expired, source frozen or retired) | `Closed(Unauthorized)` after one fresh-token reconnect also closes 1008; otherwise `Backoff` | — |
| any live | `Closed{code: 4401}` (routed subscribe failed) | `Authorizing` with a fresh token; a second 4401 in a row → `Closed(Unauthorized)` | — |
| any live | `Closed{code: 4000}` (routed doc closed) or any other code | `Backoff{attempt+1}` | — |
| any | `Authorization{current: false}` | `Closed(Unauthorized)` | W-1 append first; `SocketClose{Unauthorized}`, `AccessChanged(Read)`, then `Status` |
| `Synced` | `Authorization{can_write: true}` while `conn_access[conn] != Full` | `Authorizing` (fresh token) | `SocketClose{Superseded}`: the server fixed this connection's access at connect, so only a new connection can push (W-6) |
| any live | `SocketEvent::Frame` that fails reassembly or decode | `Backoff{attempt+1}` | `ws.message.error{stage}`, `SocketClose{ProtocolError}`; never a reset |
| any | `Stop(id)` | `Closed(Stopped)` | W-1 append and presence (cleared) pushed first; `Reply::Stopped` after the append's `Done` |
| any | reset budget spent | `Closed(Corrupt)` | W-1 append first; `AccessChanged(Read)` |

**On synced:** do these in order.

1. Send `PeerRegisterId` for every peer in `registered_peers` in insertion order, the current
   `doc.peer_id()` first. A new connection must hear them again before the reconnect replays
   edits (source.ts `reregisterPeerIds`).
1a. Import the awareness bytes of **every** `RemoteInitialSync`, first connect or reconnect,
   into the presence store only. Δ: today they are never imported (S5 §3.5, §7.18), so a new
   joiner sees existing cursors only after their next update.
2. Start convergence, as a rerun if one is in flight (`convergeFromServer({rerunIfInFlight})`).
3. Push the WAL.
4. Push presence.
5. Emit `LoadOrphans` (O-4/O-5).

The initial-sync snapshot of a *reconnect* is not imported. Today's engine also ignores
it and asks with `RequestSince`. Importing a shallow snapshot into a doc that has history is
not safe.

Routed transport changes only where frames go. The route's open/close events arrive as
`RouteEvent::{Subscribed, Frame, Closed{code}}`. The heartbeat belongs to `RouterCore` and is
not run per document, so `Connection::Synced.heartbeat` is inert for routed sessions.

#### WAL and push

```rust
struct Wal {
    entries: VecDeque<WalEntry>,     // own, adopted and foreign rows, ascending seq
    delivered_through: Option<WalSeq>,
    next_seq: WalSeq,
    logged_vv: loro::VersionVector,  // oplog vv at the last export
    append_due: Option<Millis>,      // coalesce deadline
    health: StorageHealth,           // Ok | Failed { since: Millis }
}

pub struct WalEntry { pub seq: WalSeq, pub created_at: UnixMillis, pub foreign: bool, pub bytes: Arc<[u8]>,
                     pub state: EntryState, pub not_acked: u8,
                     /// vv of the own peer before this entry's export (W-2 superset rebuild).
                     pub vv_before: loro::VersionVector,
                     pub park: Option<ParkReason>,
                     /// Rows a superset row replaced (W-2); pushed as that one row.
                     pub superseded: bool }

pub enum EntryState {
    Writing(StorageOpId),
    Logged,
    /// The store refused the append. The entry is held in memory and re-appended on the
    /// next trigger (generalizes forms' `FormWAL.unlogged`).
    Unlogged { failures: u8 },
}

enum Push {
    Idle { retry_at: Option<Millis> },
    InFlight { id: UpdateId, through: WalSeq, deadline: Millis, outage: Option<SpanKey> },
}
/// Assist pushes (O-5) have their own slot and deadline; they never count as the own push.
struct AssistInFlight { id: UpdateId, deadline: Millis }
/// Not-acked accounting for W-11: consecutive not-acked own pushes, backoff, probe state.
enum Delivery { Healthy, Suspect { not_acked: u16, next_at: Millis, delay: Millis }, Probing { request: RequestId } }
```

The rules:

- **W-1. Coalesce.** `LocalChanged` sets `append_due = now + wal.coalesce` if it is unset.
  When the deadline passes, or on `Hidden`/`PageHide`/`Flush`, or immediately while
  `Resetting` (I-3 step 0), **or on every transition into `Stopped`/`Closed(_)`** (`Stop`,
  `Authorization{current: false}`, the reset budget, the host's editor-error `Stop`, row 99),
  or before a comment publication (§2.5 step 2):
  1. `bytes = doc.export_local(&logged_vv)`;
  2. if `Some`, push a `WalEntry{Writing}` and emit `Storage(WalAppend)`. Chatter is posted on
     the append's `Done(Ok)`, not here (W-10);
  3. set `logged_vv = doc.oplog_vv()`.

  One entry per window replaces one entry per Loro commit. **Terminal rule.** `Stop(id)`
  replies `Reply::Stopped` only after that append's `Done`; the host drops the session only
  after the reply; the executor releases the Web Lock only after its storage queue drains
  (O-1). After `Closed(Corrupt | Unauthorized)` the session emits `AccessChanged(Read)` and the
  editor rejects further mutations, so nothing is typed into a session that can no longer append.
- **W-2. Persist before deliver.** A push carries `Logged` entries, as today: append, then
  flush. On a failed append of entry n (`Done(Err)` other than `Uncertain`), entry n becomes
  `Unlogged` and the next export uses `since = n.vv_before`, producing a **superset row** that
  holds n and every later entry's ops. While any entry at or after n is still `Writing`, no new
  window is issued (the deadline waits for their completions). When the superset row is
  `Logged`, the entries it subsumes (n…) are marked `superseded` in memory and pushed as that one
  row. On load, a row whose import is `pending` and whose missing deps belong to the same
  owner's earlier seqs that no store holds is parked as `Gap` with telemetry `wal.gap{owner,
  seq}` and never pushed (it is kept until TTL, never deleted). While `health = Failed`,
  `Unlogged` entries are pushable too (the server's durable ack is better than nothing; Δ:
  forms held them back). **Pushable** = the contiguous run above `delivered_through` of
  `Logged | Unlogged` entries; a `Writing` entry ends the run. A delivered `Unlogged` entry is
  never appended afterwards. This keeps the durable WAL a prefix: a crash can never leave
  seq n+1 durable and delivered without n, which would leave the server holding that peer's
  later ops pending on a counter gap.
- **W-3. One push in flight.** It carries the pushable run above `delivered_through` as one
  `PeerUpdate{updates, id}`, capped at **256 KiB or 64 entries**, whichever comes first (at
  least one entry). Its `through` is the last seq in it. The cap keeps a push single-frame and
  inside the server's 4.5 s budget after a long offline period (S6 H10: the server assumes small
  single-frame client messages and loses partial frames on hibernation). Prefix delivery still
  holds; the next push continues from `through`.
- **W-4. On ack**, matching `id` only:
  1. set `delivered_through = through` and `not_acked = 0` on those entries;
  2. emit `WalMarkDelivered`;
  3. end the outage span;
  4. answer any drained flushes;
  5. if more are pushable, push again (the `hasNewPending` rerun).
- **W-5. Not acked** (ack deadline or disconnect): return to `Idle{retry_at: now +
  retry_unacked_after}`, increment `not_acked` on the pushed entries, and open or extend the
  `wal.delivery_outage` span. A retry runs on whichever comes first: `retry_at`, the next
  append, the next `Synced`, or the snapshot tick.
- **W-6. Gates and access changes.** Pushes happen only when `Synced` and
  `conn_access[conn] == Full` and `auth.can_write` and `effective_access == Edit`. When a gate
  is closed, entries stay and `save = Unsaved(ReadOnly)`. guarded-source returned `false` in the
  same case. A server that refuses an update sends no ack (S6 M9a), so a refused push looks
  like W-5; the `conn_access` clause means the session never sends one it can know is refused,
  and pushes refused for access reasons never count toward W-11. When `can_write` turns true
  on a connection whose `conn_access` is not `Full`, the session closes it (`Superseded`) and
  reconnects with a fresh token (transition table).
  The server fixes write access per connection from the connect token (S5 §7.3, S6 M9), so
  permission loss arrives as `Authorization{can_write: false}`:
  - it sets `effective_access = CommentOnly` when `can_comment`, else `Read`, and emits
    `AccessChanged`; the editor rejects mutations from then on;
  - undelivered rows are kept and reported as `Unsaved(ReadOnly)`; they are delivered if
    write is regained (`can_write: true` restores `Edit` and emits `AccessChanged(Edit)`);
  - otherwise they expire by TTL on a later load, with `TelemetryRecord wal.expired{reason:
    revoked}`.
  Read-only sessions never produce entries in the first place (§2.2).
- **W-7. Load.** A `SessionId` is new per open, so every stored row belongs to some other
  owner. On `Loaded`:
  1. Expire orphan and legacy rows with `!delivered && created_at < now.wall - wal.ttl`:
     `WalDropExpired{from: owner, before}`, telemetry event `wal.expired{owner, seqs, reason:
     ttl}`.
  2. Adopt each remaining orphan (O-3): `first_seq = next_seq` at **issue** time, and advance
     `next_seq` by the adopted count immediately, so appends issued before `Loaded` completes
     (a remote seed may win first) never collide.
  3. Adopted rows enter `entries` with their stored `delivered` and `created_at` on the
     `Adopted{n}` completion, and only `n` of them. A conditional adopt that finds nothing
     (another tab won) adds no entries; the reserved seqs stay unused, which is harmless.
     Quarantined and gap rows come back parked.
  4. Rows of other users whose TTL passed are reported by `Load` for `WalDropExpired` only;
     they are never returned for replay or push (O-2).
- **W-8. Replay.** After **any** seed wins, and after a reset, import every own or adopted row
  with `seq > covers_for(owner)` of the current snapshot, delivered or not
  (`ImportOrigin::WalReplay`). The source is the in-memory `entries` first (every state,
  `Writing` and `Unlogged` included), then the rows `Loaded` returned that are not already in
  `entries`: after a reset the storage copy may not be complete yet. A row that fails with
  `Outdated` (it is concurrent with history below a remote seed's shallow root) is kept in
  memory as `needs_rebase`; it is still pushed. If any exist after the seed, the session pushes
  first and then runs one rebase (I-2'), after which its own rows are inside the server
  snapshot it rebases onto. Quarantined and gap rows are never replayed. This keeps offline reopen equal to today's markdown local ingest,
  which replays delivered and undelivered rows (`MarkdownDocument.tsx:121-147`). Today only a
  local seed replays them (manager.ts `ingest`); if a remote seed wins, the rows were flushed but
  never shown locally until a later catch-up. Imports are idempotent, and a row whose
  dependencies are missing stays pending until convergence fills them. If replay starts before
  `Loaded` completes (a remote seed won first), rows arriving later are imported as a normal
  remote diff. This is a behaviour change.
- **W-9. Snapshot prune.** `SnapshotSave.covers` is the last own seq exported into the doc.
  On `Done(Ok)`, emit `WalPrune{through: min(covers, delivered_through)}`. Today
  `pruneDelivered` also deletes rows delivered *after* the snapshot was exported. That is
  harmless because the server holds them, but `covers` makes the rule exact.
- **W-10. Chatter delivery.**
  1. Chatter `Update` is posted on the `Done(Ok)` of an **own** append, not on issue. A peer
     tab never builds on bytes that are not durable somewhere in the profile.
  2. A session with `effective_access == Edit` that imports chatter `Update` bytes **which
     added ops** (`Imported.new_ops`) appends them as a foreign row (`WalRecord.foreign = true`,
     the session's own `user`) in the same `handle` call, before any later window export. Read
     and comment-only sessions never store foreign rows. `export_local` never re-exports them.
  3. `Persistence::Memory` sessions have no chatter (§1.2).
  4. Foreign rows are never posted to chatter. This ends the A→B→A echo.
  5. A foreign row is marked delivered **without being pushed** when a `Live` or `Catchup`
     import from the server covers its spans (`LoroDoc::decode_import_blob_meta`). In a push a
     foreign row keeps its seq in the contiguous run, but its bytes are omitted unless
     `retry_unacked_after` has passed without such evidence, or its writer sent `Closing`, or
     its writer is an orphan. Two tabs of one doc therefore cost the server one write per edit,
     not two.
- **W-11. Poison rows: absence of an ack is never evidence.** The server withholds an ack for
  many transient reasons: a D1 mapping error before the ack (S6 M9f), a DO storage put error, a
  failed metadata restore (H2), and a connection whose access was fixed at View (S6 M9a). A row
  is poison only after a **local proof**:
  1. After 20 consecutive not-acked own pushes (counted as W-5 does, access-refused pushes
     excluded), enter `Delivery::Suspect`: retry with backoff (5 s doubling to 5 min), set
     `Unsaved(Undelivered)` and open `wal.delivery_outage{suspect: server}`.
  2. At the first suspect retry, and at most once per 10 min, send `PeerRequestSnapshot` and run
     `doc.probe_import(snapshot, head_row)`: the server's current snapshot plus the head pushable
     row, in a scratch doc that is never committed (peer from the supply, D-4b).
  3. The row is poison only if that import fails with `ImportFailure::Loro` that is neither
     `pending` nor `Outdated`. `Ok`, `pending` or `Outdated` means the failure is transient or a
     gap: keep retrying under step 1; `pending` also runs `LoadOrphans`.
  4. A proven poison row is **parked, never deleted**: `WalQuarantine{seq}` sets
     `quarantined = true`; the row stays until TTL and in the local doc; telemetry
     `wal.poison{seq, bytes}`. The session stops pushing it, then immediately runs a reset
     (I-3, budget charged), which gives a fresh peer and a server base that excludes the poison,
     so later edits never depend on it. `save = Unsaved(Poison)` while the parked row exists;
     it is never `Saved`.

  A D1 outage, storage incident or View-token connection therefore delays delivery and shows
  `Unsaved`, and never deletes or strands an edit.

#### Convergence (anti-entropy)

```rust
enum Convergence {
    Idle,
    InFlight { vv_bytes: Vec<u8>, attempt: u8, deadline: Millis, rerun: bool },
    RetryAt { attempt: u8, at: Millis },
}
```

- **C-1.** Triggers:
  - entering `Running` while `Synced`;
  - every `Synced` transition (sets `rerun` if one is in flight);
  - an import that reports `pending`.
- **C-2.** Send `PeerRequestSince{vv: oplog_vv.encode()}` and keep those exact bytes. The
  server answers on one socket strictly in order (frames are processed serially under the
  barrier, S6 E2/M12/M13), but it sends **no reply** when `RequestSince` errors (a bad vv, a
  state-load failure in stage `unknown`, S6 M5/M12). Correlation is therefore:
  - one FIFO per `ConnId` **and request kind** (`RequestSince`, `RequestSnapshot`);
  - a timed-out entry stays as a tombstone until the connection closes; a late reply that
    matches it is consumed and dropped;
  - a `RemoteUpdateSince` whose echoed vv bytes do not equal the head's is matched against the
    nearest later entry with equal bytes, and the skipped entries fail as `Timeout`; a reply
    that matches nothing is dropped with telemetry;
  - `RemoteSnapshot` has no echo, so it goes to the head of the snapshot FIFO; any requester
    accepts any fresh snapshot (a reset may use a comment staging's reply and vice versa, both
    are equally fresh), and every waiter queued before it is answered from the same bytes;
  - every `RouteEvent::Subscribed` and `RouteEvent::Closed` allocates a new `ConnId` for the
    routed session and clears its FIFOs.
- **C-3.** On an empty `update`, do nothing (zero bytes are not a Loro payload). Otherwise
  import it with `Catchup`. If the import is still `pending`, rerun up to
  `converge.max_attempts`, then stop until the next trigger. That prevents a loop when the
  missing ops never reached the server (§3.5 gap).
- **C-4.** On timeout, retry after `retry_delay`, up to `max_attempts`. Every retry re-reads
  `oplog_vv` (Δ: today's retries reuse the original `since`, S5 §7.18). A non-error empty reply
  is not retried (≡).
- **C-5.** On settle, rerun once if `rerun` was set.

#### Imports and reset

- **I-1.** Sources are `RemoteUpdate`, `RemoteUpdateSince`, chatter, and WAL replay. A
  `RemoteSnapshot` is consumed only by its requester (a reset, `RequestSnapshot(id)`, comment
  staging), matched FIFO per `ConnId` (C-2), and is never imported as an update (Δ: today an
  `incremental_snapshot` is imported as an update; importing a shallow snapshot into a doc that
  has history is not safe). An import outside `Running` is dropped. Convergence on the next
  `Running` entry fetches what was missed. This replaces the source's pre-listener buffer and the
  stale generation checks.
- **I-2'. Outdated is a rebase.** `ImportFailure::Outdated` (Loro
  `ImportUpdatesThatDependsOnOutdatedVersion`: the update's deps are below this doc's shallow
  root) is **not corruption**. It schedules a *rebase*: I-3 without the `reset_budget` charge,
  coalesced (one in flight; a failure during it sets `rerun`, which runs once more),
  rate-limited to one per 10 s, with `save = Unsaved(Rebasing)` until it completes. Live,
  catch-up and chatter imports all take this path; W-8 replay defers it until after its push.
  Telemetry `doc.sync.rebase{cause}` (§4.7). This replaces today's reset on the same error
  (S5 §2.1 `handleRemoteUpdate`), which is why a reconnecting peer no longer resets every
  online editor.
- **I-2.** If `ImportFailure::{Loro, Projection}` occurs and the import was not merely
  pending, start a reset.
  Projection failures on a local commit also reset (engine.ts resets when `syncStateToLoro`
  fails). A `Reset` input or failure while `Loading` sets `reset_requested`; the reset starts on
  entering `Running` (S5: `engine.reset()` while not running). Mutating editor input before
  `Seeded` is rejected with `ViewEffect::Error(NotReady)` (§2.2).
- **I-3. Reset:**
  0. Force the W-1 append from the old doc now (`export_local(&logged_vv)`), before anything
     else. While `Resetting`, local edits still apply to the old doc, and every one of them
     forces an immediate append. Today every commit is appended at once, so `flushPending`
     covers everything (S5 §2.1 `reset` 3a); without this step the ≤25 ms window and edits
     typed during the reset would be lost when `replace` drops the old doc. Count the reset
     against `reset_budget` here.
  1. Run `Flushing`: one push attempt, or wait for the in-flight one, bounded by `ack`.
  2. Run `AwaitingSnapshot`: `PeerRequestSnapshot`. If not connected, wait for `Synced`, then
     request.
  3. Call `doc.replace(snapshot, new_peer)` with the next peer from the session's peer
     supply (§2.1).
  3a. Replay the WAL (W-8). Then set `logged_vv = doc.oplog_vv()` on the **new** doc, add the
     new peer at the front of `registered_peers`, and send `PeerRegisterId` now if `Synced`.
  4. Rebuild `EditorSurface.undo` on the new doc (history cleared; the surface emits
     `Effect::HistoryState(HistoryAvailability { can_undo: false, can_redo: false })`).
     Set the old presence key to `None` and push it before setting the new peer's key, so peers
     don't show a ghost cursor for one timeout. Re-resolve the projection's container cache.
  5. Emit `Replaced` and return to `Running`.

  On failure, return to `Running` on the old doc, as today. `reset_budget` (charged only by
  `Loro`/`Projection` failures and W-11 poison) exceeded leads to `Closed(Corrupt)` with
  `Status`, after the W-1 terminal append; the WAL is kept untouched for the next open. Today the reset
  can loop forever on a persistently bad peer.

#### Snapshots, seeding and presence

- **S-1.** Every `snapshot_interval` while `Running`, with `Durable` persistence and the
  oplog vv changed since the last save (Δ: today the tick saves every 5 s unconditionally):
  1. run the coalesced append first (today the tick calls `wal.flush()`);
  2. skip the save while any own entry is `Unlogged` or `health = Failed`: a snapshot must never
     hold own ops that no durable or delivered row holds. Save again once the superset row
     (W-2) is `Logged` or the entry is delivered;
  3. defer the save while `append_due` was set within the last 1 s (typing), up to a maximum
     staleness of 30 s, so the O(document) export does not run between keystrokes;
  4. then emit `SnapshotSave{export_shallow_snapshot(&confirmed_base), covers}` with span
     `doc.snapshot.save{bytes, ms}`.
- **S-1'.** `confirmed_base` is the frontiers of the doc right after the last completed
  convergence (C-3 `Applied`/`Empty` while `Synced`), i.e. a base the server is known to hold.
  It starts as the seed's frontiers. Exporting the shallow root there, not at
  `oplog_frontiers()`, keeps every later local op above the root, so a concurrent remote op
  made after the base imports normally on the next open.
- **S-2. Seed race.** `Loading` accepts the first of these seeds:
  - `Seed{Optimistic|CachedS3}`;
  - `Loaded{snapshot: Some}` (Local). An empty stored snapshot counts as `None` (S5 §2.3
    `hasLocalSnapshot` requires `byteLength > 0`);
  - the first `RemoteInitialSync`.

  Later ones are discarded, with telemetry `doc.seed` `outcome=discarded`. A local
  snapshot that fails to import is deleted (`SnapshotDelete`), as `loadCachedState` does, and
  the race continues (Δ for markdown, which never deleted a corrupt snapshot, S5 §7.17). The
  late `RemoteInitialSync` may also win while `Loading` (Δ for row 51). **S-2'.** When the
  local load is in flight and the open has undelivered orphan rows to replay (known from
  `Loaded`, so a remote seed that arrives first waits up to `timeouts.storage` for it), the
  local seed wins over the remote one: offline edits then replay onto their own base instead of
  failing `Outdated` against a remote shallow root. After the winner, replay the WAL (W-8) and emit `Seeded`. If the
  replay imported at least one row, save a fresh snapshot immediately (`ingestLocalSnapshot`
  folds the replay into the snapshot).
- **S-3.** `Phase::Running` begins when the session acknowledges `Seeded` by initializing its
  surface. The editor's `didFirstSync` gate is this transition.
- **P-1. Presence.** `PresenceStore` wraps `sync_protocol::presence::EphemeralStore`, the same
  clock-injected store the server uses (S6 §2.1). It speaks loro's `EphemeralStore` encoding, so
  the server and old TS clients merge it unchanged. Its API is `set(key, value, now)`,
  `apply(bytes, now)`, `encode(key, now)`, `encode_all(now)` and `remove_outdated(now)`, with
  `now: UnixMillis` (wall, never `Millis`). Loro keeps the **sender's** timestamp and drops an
  entry when `receiver_now - timestamp > timeout`, and LWW compares sender timestamps, so clock
  skew between peers is observable (S8 `ClockSkew`). The local key is the peer id string
  (`PresenceKeyMode::Peer`) or the AI worker's fixed key. The value's wire shape is pinned
  (old clients decode it, `awareness.ts:20-23`, `LexicalAwareness.ts:16-41`):

  | Path | `LoroValue` | Rust writes | Rust reads |
  | --- | --- | --- | --- |
  | `user.userId` | `String` or `Null` | always present; `Null` when anonymous | `String`/`Null`/missing |
  | `user.color` | `String` | palette colour | as written |
  | `user.peerId` | `String`, decimal u64 | never `I64` | `String` |
  | `selection` | `Map` or `Null` | `Null` when no selection | `Null` or missing ⇒ no selection |
  | `selection.{anchor,focus}.nodeId` | `String` | nodeIdPlugin `$.id`, never a `NodeKey` | as written |
  | `selection.{anchor,focus}.cursor` | `Binary` | `loro::cursor::Cursor::encode()`, anchored per S5 §4.5 (via S11) | `Cursor::decode` |
  | cleared state | `Null` value | `set(key, Null)`, not a delete | `Null` ⇒ absent |

  A cross-language fixture test round-trips JS-encoded presence → Rust decode → Rust
  re-encode → JS `decode`; S8 §7.4 client transcripts compare decoded presence values.
  - **Needs:** nothing beyond S6 C1/C9a. A Loro upstream PR adding `*_at(now)` variants would
    let `sync_protocol` drop the vendored module.
- **P-2.** Local presence is **coalesced into the W-1 window**: `SetPresence` stores the value
  and sets `presence_due = min(append_due, now + wal.coalesce)`; the tick sends one
  `PeerAwareness` (when the socket is open, not buffered, as source.ts does) and one chatter
  `Awareness` per window, after that window's append. Remote cursors at 40 Hz are
  indistinguishable from per-key, and a keystroke returns flags `0` (or `WAKE_CHANGED`).
  `Hidden`/`PageHide`/`Stop` flush it with the append. `remove_outdated` runs on `Tick` at the
  next expiry (it feeds `wake_at`). `refresh` re-sends an unchanged value while connected.
  Remote presence lists exclude self and entries without a selection (Δ: presence used to go
  out on each selection change; row 10).

### 1.8 Peer ids

- **PE-1.** Every `LoroDoc` instance gets a peer id that **no other instance has used**.
  That covers cold start, reset, and the staged comment fork. The id is set with `set_peer_id`
  immediately after `new()`/`fork()`, before any op (D-4b).
- **PE-2.** Reusing a peer whose ops are not all in the new instance reuses counters and
  corrupts the CRDT. Today's code gets this right by accident (`createLoroDoc` is random per
  instance). The Rust session takes ids from a host-supplied supply (§2.1) and never derives
  them.
- **PE-3.** `registered_peers` keeps every peer this session used, because undelivered WAL
  rows written by an earlier peer of the same session are replayed and pushed under it. The
  server records writers from the update content anyway (`add_writing_peerids`). Order is
  insertion order with the current peer moved to the front, since the server blames the first
  registered peer (S6 M9c).
- **PE-4. AI range.** `SessionConfig.peer_range = PeerRange::Ai` (ai-editing-worker sessions)
  requires every supplied id to be in `[AI_PEER_BASE, AI_PEER_BASE + AI_PEER_COUNT)`
  (`ai-peer.ts`; `AI_PEER_BASE = 0xa1a1_a100_0000_0000`) and rejects others with
  `SessionError::PeerOutOfRange`. `PeerRange::User` rejects ids in the AI range or the legacy AI
  block, so `isAiPeer` and the server's `active_peers(include_ai: false)` filter (S6 H3) keep
  working.

### 1.9 `RouterCore` (multiplexed transport)

`RouterCore` is one per page. It owns the router socket's `Connection`: the same machine as
above with `heartbeat` live and `RemoteInitialSync` replaced by "open". It also owns one
`Route` per attached document:

```rust
pub struct RouterCore { connection: Connection, routes: BTreeMap<SyncDocId, Route>, /* backoff, tokens */ }

enum Route {
    /// Each element is one **frame** of a `FromPeer` message; each frame becomes one
    /// `RouterFrame` envelope, as `router.ts:376` does (`intoFrames` per message first).
    Subscribing { attempt: u32, pending: Vec<Vec<u8>> },
    Open { reassembler: Reassembler },
    Dropped { retry_at: Millis, delay: Millis },          // 500 ms doubling to 8 s
    Closed,
}

impl RouterCore {
    pub fn attach(&mut self, doc: SyncDocId, initial_token: Option<SyncToken>, out: &mut RouterOutput);
    pub fn detach(&mut self, doc: &SyncDocId, out: &mut RouterOutput);   // `RouterUnsubscribe` when last
    pub fn handle(&mut self, now: Now, input: RouterInput, out: &mut RouterOutput);
}
pub struct RouterOutput { pub io: Vec<IoEffect>, pub to_sessions: Vec<(SyncDocId, RouteEvent)>, pub wake_at: Option<Millis> }
```

It keeps today's mapping: first `RouterSubscribed` → open; any later one → reconnect;
`RouterSubscribeFailed` → `Closed{4401}`; `RouterDocClosed` → `Closed{4000}`; and a router
reconnect resubscribes every route. Token requests are per route (`FetchToken{attempt, doc}`,
typed in §1.5 and encoded as tag 1 in §4.2). Today a second owner joining an open route forces a resubscribe, because the Durable
Object sends `RemoteInitialSync` once per downstream connection. That behaviour is kept,
since one session per (doc, mount) is still the model. A candidate improvement, not in this
spec: the Host shares one `DocumentSession` across mounts of the same doc.

---

## 2. `document_session`

### 2.1 Types

```rust
pub struct DocumentSession<S: Surface> {
    doc: loro::LoroDoc,
    surface: S,
    sync: SyncCore,
    peers: PeerSupply,          // host-provided unused peer ids, refilled through output
    access: Access,
    out: SessionOutput,         // reused buffers
    sync_out: SyncOutput,
}

/// Host-generated random u64s (crypto.getRandomValues / SecRandomCopyBytes). The session
/// asks for more with `IoEffect`-free `SessionOutput.need_peer_ids` when fewer than 2 remain.
pub struct PeerSupply(VecDeque<loro::PeerID>);

pub struct SessionConfig {
    pub sync: SyncConfig,
    pub peer_ids: Vec<loro::PeerID>,        // at least 3
    pub peer_range: PeerRange,              // User | Ai (PE-4)
    pub surface: SurfaceConfig,
}

pub enum SurfaceConfig {
    Editor(EditorConfig),     // registry (Macro nodes), list indent, markdown shortcuts, …
    Generic(GenericConfig),   // roots to observe: Vec<ContainerPath>
}

impl<S: Surface> DocumentSession<S> {
    pub fn new(config: SessionConfig, now: Now) -> Result<Self, SessionError>;
    pub fn handle(&mut self, now: Now, input: SessionInput) -> &SessionOutput;
    pub fn surface(&self) -> &S;            // read-only queries; no I/O
}

pub enum SessionInput {
    Sync(SyncInput),
    /// lexical_model::Input. Keystrokes, commands, view selection, composition, undo/redo.
    Editor(lexical_model::Input),
    /// Generic surfaces: applied in one Loro transaction.
    Doc(Vec<DocOp>),
    Comment(CommentMarkRequest),
    AddPeerIds(Vec<loro::PeerID>),
}

#[derive(Default)]
pub struct SessionOutput {
    pub view: Vec<ViewEffect>,
    pub io: Vec<IoEffect>,
    pub wake_at: Option<Millis>,
    pub need_peer_ids: bool,
}

pub enum ViewEffect {
    /// First paint after a seed, and after a reset (`Replaced`). A full diff from empty, or
    /// the generic surface's observed values.
    Initialize(InitialView),
    Diff(lexical_model::Diff),
    Editor(lexical_model::Effect),   // SetViewSelection, ScrollIntoView, HistoryState, …
    DocChanged(Vec<DocEvent>),
    Presence(Vec<PeerPresence>),
    Status(SyncStatus),
    Reply { request: RequestId, reply: Reply },
    Error(SessionError),             // editor init failure → today's MarkdownEditorErrors
}
```

`Surface` is internal to the crate. Its two impls are `EditorSurface` and `GenericSurface`.
The wasm and FFI crates export one class per impl.

```rust
pub trait Surface {
    fn init(&mut self, doc: &loro::LoroDoc, view: &mut Vec<ViewEffect>) -> Result<(), SessionError>;
    fn import(&mut self, doc: &mut loro::LoroDoc, bytes: &[u8], origin: ImportOrigin,
              view: &mut Vec<ViewEffect>) -> Result<Imported, ImportFailure>;
    fn replaced(&mut self, doc: &loro::LoroDoc, view: &mut Vec<ViewEffect>) -> Result<(), SessionError>;
}
```

`DocumentSession` implements `SyncDoc` by lending `(&mut doc, &mut surface, &mut out.view)`
for the duration of `sync.handle`. That makes the view effects of a remote import part of
the same output.

### 2.2 `EditorSurface`

```rust
pub struct EditorSurface { core: lexical_model::EditorCore, projection: lexical_loro::LoroProjection, undo: loro::UndoManager }
```

- **Local edits.**
  1. `core.apply(input, now)` (S1 §15) gives `Output { commits, diff, effects, handled }`.
     `commits` is almost always one commit; it is two when a step calls
     `Transaction::set_editor_state` and commits pending work early (S1 F-24).
  2. If `access == Edit`, for each commit in `commits` (oldest first) that has synced changes,
     `projection.local_commit(&commit)` writes Loro ops and calls `commit_with(timestamp)`.
     On `Err(ApplyError { error, committed })` the editor state already includes `committed`
     (S1 §15.2), so those commits are projected the same way before the error becomes
     `ViewEffect::Error`; otherwise the Loro doc would lag the editor.
  3. Call `sync.handle(LocalChanged)`.
  4. Compute the selection cursor with `projection.cursor(&selection)` (S11; O(log n) through
     its key→container map) and hand it to `sync.handle(SetPresence(..))`, which only stores it
     until the window tick (P-2).
- **Before `Seeded`.** Mutating input is rejected with `ViewEffect::Error(SessionError::NotReady)`
  and leaves the state unchanged (today CollabProvider's `didFirstSync` gate). Selection input
  is accepted.
- **Read and comment-only** (the *effective* access, so a mid-session `can_write: false`
  applies too, W-6). Mutating commands are rejected: the session
  answers `ViewEffect::Error(SessionError::ReadOnly)` and leaves the state unchanged.
  Local-only state is still allowed: draft comment marks, `local-status`, selection.
  This replaces `readonly()` in engine.ts and `writeStateToLoro`'s guard in CollabProvider.
- **Remote.**
  1. `projection.remote(bytes)` gives `Vec<NodeChange>`.
  2. `core.apply(Input::ApplyRemote { changes, options }, now)` gives a `diff`; `options.tags`
     carries today's remote-update tags (`UpdateTag::Custom("from-loro")`, S1 §17 `LexicalUpdateTags`)
     so plugins treat it as remote.
  3. Restore the local selection from the local presence cursor. If the editor is not
     focused, use a `SkipDomSelection` effect. This replaces `syncStateToLexical`'s two
     updates and microtask.
- **Build.** The editor is the S3 preset for the surface (`preset_builder(ty)`, which is
  `Editor::builder(EditorMode::ViewAttached)`; the ai-editing-worker's session uses
  `headless_builder()`, `EditorMode::Headless`) plus `.opaque_unknown_types(true)`: a
  collaborative session must keep node types written by newer clients (S1 D-23 ruling; routes
  and the comment gate leave it off). The host goes on the builder, `.view_host(host)` (S1 §15,
  R2.1; `CoreConfig` has no platform field): the web session takes `ViewHost` from
  `SessionConfigMsg`, the FFI sessions use `ViewEngine::Native` with the device's `ViewOs`, and
  plugins read it through `Transaction::view_host`. `CoreConfig.history` is `None`, because undo
  is Loro's (below).
- **Initial output.** Right after `EditorCore::new`, the surface drains
  `EditorCore::take_initial_output()` once (the NodeId/PeerId `Plugin::after_commit` rounds
  that `build()` ran over the loaded state, S1 §14.2) and projects it with `local_commit` like
  any other output, before the first input (S11 §5.1).
- **Outputs.** Every `Output::commits` slice (preceding, the commit, then the
  `Plugin::after_commit` follow-ups) is projected as one Loro commit (S11 §3.2) and fed to the
  merge tracker commit by commit. `Effect::PluginEvent` is routed to the session's handler for
  its key (Autolink's `AutoLinkChanged` becomes a `ViewEffect::Editor` for the view);
  `Effect::FollowUpFailed` is reported as a `Telemetry` error record and the session goes on
  (upstream `_onError`; the commits before it stand). The `SetViewSelection` elision is
  EditorCore's (S1 §15.1 step 4); the session adds no rule of its own.
- **Init.** Empty doc → empty editor with fresh node ids (`initializeEditorEmpty`).
  Otherwise build `EditorState` from the doc, strip abandoned draft marks, and if any were
  stripped, write the cleaned state back as one local commit (today's `FORCE_SYNC_COMMAND`).
  Init errors become `ViewEffect::Error`.
- **Undo** runs over `loro::UndoManager` with `merge_interval = 0` and `max_undo_steps = 100`
  (as `createUndoManager`). `Input::Undo`/`Input::Redo` are handled by the surface and never
  reach `EditorCore` (whose `CoreConfig.history` is `None`); the undo's Loro changes come back
  through `projection.remote` and `Input::ApplyRemote`. `exclude_origin_prefixes = ["history-"]`
  stays, and lexical's merge heuristics drive `group_start`/`group_end` (D-4): on each local
  commit the surface calls `classify(&commit, now) -> HistoryAction` on the one S1 `MergeTracker`
  it keeps (`MergeTracker::new(delay_ms, now)`, the classifier behind `History::record`, S1 §12,
  usable without `History`, which would retain an `EditorState` per `Push` that the session
  never reads; S11 §7.2's grouper is this), and
  `HistoryAction::Push` closes the current group and opens a new one, `Merge` keeps it,
  `Discard` records nothing. Today `undo.ts:244` guards a WASM
  panic in `groupStart` on an empty doc; in Rust that path returns `Err` and the group is
  skipped, never a panic (CS-57). After a reset the manager is rebuilt on the new doc (I-3
  step 4). SCOPE's open M2 question is answered here as **Loro's `UndoManager`**, because only
  the session sees remote ops.

**Needs from siblings.**

- **S11** owns `lexical_loro`'s live projection: `local_commit(&mut self, &mut LoroDoc,
  &Commit) -> Result<(), ProjectionError>` (writes ops without exporting), `remote`, the
  `NodeKey ↔ ContainerID` map and its rebuild after `SetState`/reset, and `cursor`/`point`
  mapping. This spec only calls them; where S11's signatures differ from the shapes sketched
  here, S11 wins.
- `lexical_model` needs **no** wire encoding of `Input` (R2, §4.2): the wasm crate maps its own
  bebop `EditorInputMsg` onto `Input` by hand. The open S1 requirement is withdrawn.
- S1 (done in S1 R2.1): `MergeTracker::classify` (above), and `Plugin::after_commit` follow-up
  rounds so node ids are assigned inside `apply` (audit R2-4 H5; S1 §14.2, NodeId/PeerId in S3),
  with `EditorCore::take_initial_output` for the build-time round.

### 2.3 `GenericSurface` (forms, spreadsheets, canvas, collab surfaces without an editor)

```rust
pub struct ContainerPath { pub root: String, pub steps: Vec<PathStep> }
pub enum PathStep { Key(String), Index(u32), Id(loro::ContainerID) }

pub enum DocValue { Null, Bool(bool), Number(f64), Int(i64), String(String), Bytes(Vec<u8>),
                    List(Vec<DocValue>), Map(BTreeMap<String, DocValue>), NewContainer(ContainerKind) }

pub enum DocOp {
    MapSet { map: ContainerPath, key: String, value: DocValue },
    MapDelete { map: ContainerPath, key: String },
    ListInsert { list: ContainerPath, index: u32, value: DocValue },
    ListDelete { list: ContainerPath, index: u32, len: u32 },
    MovableListMove { list: ContainerPath, from: u32, to: u32 },
    MovableListSet { list: ContainerPath, index: u32, value: DocValue },
    TextSplice { text: ContainerPath, index: Utf16Offset, delete: u32, insert: String },
}

pub enum DocEvent { Map { path: ContainerPath, updated: BTreeMap<String, Option<DocValue>> },
                    List { path: ContainerPath, delta: Vec<ListDelta> },
                    Text { path: ContainerPath, delta: Vec<TextDelta> } }

impl DocumentSession<GenericSurface> {
    /// Synchronous read, not an input: `get_deep_value` at a path, as JSON-shaped values.
    pub fn read(&self, path: &ContainerPath) -> Result<DocValue, SessionError>;
}
```

- `Doc(ops)` runs in one transaction, then `commit_with(timestamp)`, then `LocalChanged`. A
  failing op rolls back the whole batch and replies `Error(InvalidOp{index})`.
- Remote imports collect Loro's `subscribe_root` diff events into `DocEvent`s. This is the
  internal Rust subscription; nothing crosses to JS until the output.
- Forms keep `applyLayout(previous, next)` and turn its result into `DocOp`s. The publish
  after 750 ms of delivered edits stays app-level, triggered by `Status.save` moving to
  `Saved`. The format-version gate stays app-level through `read`.

### 2.4 Flush

`Sync(Flush(id))`, which was `FLUSH_COLLABORATION_COMMAND` and form `flush()`, does three
things:

1. It forces the coalesced append.
2. It waits for `Writing` entries to complete and the resulting push to be acked.
3. It replies `Drained`, or `NotDrained{undelivered}` at `timeouts.storage + timeouts.ack`
   after the request, or `Offline`/`ReadOnly` immediately. `TransportKind::None` replies
   `Drained` once appends complete.

Today's `flushPending` waits for in-flight appends the same way.

Parked entries (W-11 poison, W-2 gap, rows held by `ReadOnly`) never drain by waiting, so once
only parked entries remain, `Flush` replies `NotDrained{undelivered}` at once, counting them.

### 2.5 Comment publication (comment-only and editors, `publishCommentMark.ts`)

`Comment(CommentMarkRequest{request, mark_id, action: Add{anchor, focus, text} | Remove})`
runs as a small state machine:

0. **Gate.** The comment goes out only when `Synced ∧ auth.current ∧ (auth.can_comment ∨
   auth.can_write)`. Not `Synced` → reply `Refused(CatchupFailed)` immediately. Not authorized
   → `Refused(Unauthorized)`. This mirrors guarded-source dropping `commentOnly` and
   `canWrite()` blocking commenters (S5 §7.2).
1. Send `RequestSince(oplog_vv)` and import the result. This catches up so the
   cursors resolve against server-current containers. It replaces the
   staged-snapshot-plus-compare dance.
2. Run the W-1 append first. Refuse `LocalChangesPending` while `oplog_vv ≠ logged_vv` for the
   own peer or any own entry is not delivered (a `Writing` entry is not delivered). Otherwise
   the fork's update would depend on ops the server lacks, the server's `root_change` returns
   `Ok(None)` and refuses silently (S6 M10). A read or comment-only session never has any.
3. `fork = doc.fork()`, then immediately `fork.set_peer_id(peers.next())` (D-4b). A temporary `EditorCore` built
   from the fork (the session's builder with `EditorMode::Headless`, `.opaque_unknown_types(true)`,
   `CoreConfig.history: None`) applies the mark wrap or unwrap. Refuse with `SelectionChanged` if the text
   under the cursors is not `text`. An existing mark counts as already placed: an earlier
   request may have landed even though its ack was lost.
4. `update = fork.export(updates since fork vv)` → `sync.handle(PublishComment{request,
   update})`. The bytes go out as `PeerCommentUpdate`. They **never** enter the WAL, so a
   refused mark cannot wedge the WAL behind it.
5. On ack, import `update` into the live doc (`ImportOrigin::CommentEcho`) and reply
   `Accepted`. On timeout or disconnect, reply `NotAcked`. Refusals carry today's reasons as
   an enum: `SnapshotFailed`, `CatchupFailed`, `SelectionChanged`, `LocalChangesPending`,
   `StagingFailed`, `Cancelled`, plus the new `Unauthorized` (step 0). The fork's peer is added
   to `registered_peers` and emitted as `TelemetryRecord peer.assigned{peer, purpose:
   comment_fork}` (the sim maps it to S8 `PeerAssigned`). Every new peer emits the same record
   (`initial`, `reset`, `probe`).

---

## 3. End-to-end flows through one `handle` call

### 3.1 A keystroke (DOM-first typing, `Access::Edit`, connected)

```
beforeinput (browser inserts "a")
  JS: flags = session.textFromView(key, "…a…", 5, 5, SEL_RANGE, 0, undefined, now)
  ── one wasm call ──────────────────────────────────────────────────────────────────────
  decode primitives → SessionInput::Editor(Input::TextFromView{..})
  EditorCore::apply(input, now) → Output{commits: [Commit{changes.dirty_leaves: {key}}],
                                  diff: Diff{view_text_matches: Some(key), ops: []}}  (DOM already shows it)
  LoroProjection::local_commit → LoroText(container of key).splice(4, 0, "a"); commit_with(ts)
  SyncCore::handle(LocalChanged)   → append_due = now + 25 (if unset); no export, no bytes
  cursor = projection.cursor(sel) → SyncCore::handle(SetPresence(..)) → stored; presence_due set
  out = { view: [], io: [], wake_at: min(now+25, heartbeat, …) }
  returns flags = 0, or WAKE_CHANGED on the first key of a window
  ───────────────────────────────────────────────────────────────────────────────────────
  JS: nothing, or re-arm the one timer (one `wakeAt()` read)
```

Model cost: `EditorCore` plus one `splice` plus a vv bump. That is O(1) in document size.
Today's `toJSON()` (14 ms on the 500 KB doc) and the whole-document mirror diff are gone.
The per-window work, once per 25 ms and not per keystroke:

```
timer → flags = session.tick(now, wall)
  SyncCore: append_due passed → doc.export_local(&logged_vv) → bytes (all keystrokes in window)
            WalEntry{seq 42, Writing(op 9)} → IoEffect::Storage{9, WalAppend{seq 42, bytes}}
            presence_due passed → PresenceStore.set(peer, v, wall) → SocketSend(PeerAwareness), ChatterPost(Awareness)
IDB put completes → flags = session.storageDone(9, OK, 0, now, wall)
  SyncCore: entry 42 Logged → IoEffect::ChatterPost(Update(bytes))   (W-10: gossip once durable)
            Push::Idle → PeerUpdate{updates:[bytes], id:"<session>:17"}
            → IoEffect::SocketSend(frame(s)); Push::InFlight{deadline: now+5000}; Status(Saving)
socket frame → flags = session.socketFrame(conn, frame, now)
  Reassembler → FromRemote::RemoteUpdateAck{id:"<session>:17"} → delivered_through = 42
            → IoEffect::Storage(WalMarkDelivered{through 42}); Status(Saved)
```

### 3.2 A remote update

```
ws message → flags = session.socketFrame(conn, frame, now)
  ── one wasm call ──────────────────────────────────────────────────────────────────────
  Reassembler(conn) → complete bytes → FromRemote::decode → RemoteUpdate{update}
  SyncCore (Running) → doc.import_remote(update, Live)   [SyncDoc impl = session]
     EditorSurface::import → LoroProjection::remote(update) → Vec<NodeChange> (only touched nodes)
                           → EditorCore::apply(Input::ApplyRemote{changes, options}, now)
                           → Diff{ops: [Text{k}, CreateText{..}]}
                           → selection restore from local cursor → Effect::SetViewSelection
                           → view.push(Diff), view.push(Editor(SetViewSelection))
     → Imported{changed: true, pending: false}
  TelemetryRecord(edit.apply, update.bytes, outcome=applied)
  out = { view: [Diff, SetViewSelection], io: [Telemetry], wake_at }
  ───────────────────────────────────────────────────────────────────────────────────────
  JS: reconciler applies Diff to the DOM; sets the DOM selection; forwards telemetry
```

If the import reports `pending`, the same call also emits `SocketSend(PeerRequestSince{vv})`
(C-1). If it fails `Outdated`, it schedules a rebase (I-2'). If it fails otherwise, the same
call forces the pending append from the old doc (I-3 step 0), enters `Resetting::Flushing` and
emits the push.

### 3.3 Cold open of a cached document, offline

`new(config)`, then `Sync(Start)`, which emits `Storage{Load}` and `FetchToken`. Then:

1. `Loaded{snapshot, orphans: [..], assist: [..]}` leads to Local seed, `WalDropExpired`,
   `WalAdopt`s, and WAL replay. The output is `Seeded`, then `ViewEffect::Initialize` and
   `Status(Unsaved(Undelivered))`.
2. `Token::Failed` leads to `Backoff` (no fallback: a cached open has no initial token).
3. Edits work offline and append to the WAL.
4. `Online` leads to `Authorizing` → `Connecting` → `Synced`, then register, converge and push.

### 3.4 Reset

A failed import forces the pending append from the old doc (I-3 step 0) and moves to
`Resetting::Flushing`, which pushes once and gets an ack or a timeout. Then `AwaitingSnapshot`, which sends `PeerRequestSnapshot`. Then `RemoteSnapshot`
leads to `doc.replace(snapshot, peer)`, WAL replay, `Replaced`, `ViewEffect::Initialize`
(full diff), and `Running`. Convergence then runs.

### 3.5 Multi-tab WAL ownership (new; closes a gap in today's code)

Today every tab of a document shares one WAL scope (`scopeId = documentId`), and each
`WALSyncer` pushes everyone's undelivered rows. That works because imports are idempotent.
But a tab's in-memory index can't see the other tab's rows, which conflicts with W-3's prefix
delivery. Rows are therefore owned:

- **O-1.** Rows are keyed `(doc, owner, seq)` and carry `user`. On web, a session holds the Web
  Lock `macro-wal:{doc}:{session}` while it lives (`navigator.locks.request`, mode exclusive);
  storage ops wait for the grant (SC-9). The lock is released when the session is dropped,
  after the W-1 terminal append and after the executor's storage queue drains. The executor
  posts `ChatterMessage::Closing` from the lock-release callback, never before, so a peer's
  `LoadOrphans` sees the rows as orphans and adopts them. A held Web Lock makes the page
  ineligible for Chromium's back/forward cache; if that matters, release on
  `pagehide{persisted}` after the forced append and treat the session's own owner as foreign on
  `pageshow` (R-4). On native, leases are an
  in-memory registry in the one process that owns the file (S9 §6): a session registers its
  `SessionId` on open and deregisters on close. At open the process writes a random
  `process_epoch` into `meta`. A persisted row is an orphan iff its `owner` is not in the live
  registry. There is no lease table (process ids are reused, survive crashes as stale rows, and
  one process may host several mounts of one doc).
- **O-2.** `Load`/`LoadOrphans` return rows of owners whose lock is free:
  `navigator.locks.query()` lists held locks without acquiring them. Rows with no `owner` field
  (`Legacy`, written by pre-Rust bundles) are always orphans. Only rows whose `user` equals the
  session's `user` are returned. Other users' rows are kept until TTL, never pushed under the
  current token: the server maps writing peers to the pushing user (S6 M9f), so that would
  misattribute or wedge them. A legacy row has no `user`; it is adopted by whoever is signed in,
  which is exactly what pre-Rust bundles already do with it (≡).
- **O-3.** The core adopts each orphan with `WalAdopt`. That is atomic and conditional on
  `owner == from`, so a crash mid-adopt either leaves the orphan intact or moves it fully, and
  adoption by two tabs at once is safe: the second finds nothing.
- **O-4.** **Chatter dependencies.** Tab A gossips an update to tab B, B builds on it, and A
  dies before delivering. W-10 closes this: A posts chatter only after its append is durable
  (so the bytes survive A in the profile's WAL), and B stores the imported bytes as a foreign
  row that B itself delivers. `LoadOrphans` still runs on every `Synced`, on `Closing` (posted
  after A's lock is released, O-1), on `Visible`, when convergence ends still pending, and on
  every S-1 tick at most once per 30 s while assist rows or live foreign owners were seen, to
  adopt anything else A left (including a dead tab's write that completed after the survivor's
  load). S8 tests this with multi-tab
  profiles (`no_persisted_edit_lost`, `no_dependency_stuck`).
- **O-5. Assisted delivery.** `LoadOrphans` also returns undelivered rows of *live* foreign
  owners of the same user as read-only `assist` rows (pushed in `AssistInFlight`, its own slot
  and deadline, never counted as the own push): a frozen tab (Page Lifecycle "frozen",
  mobile Safari backgrounding) still holds its Web Lock, and an old bundle doesn't take one. The
  session pushes assist rows in a separate `PeerUpdate`, never marks them and never adopts them.
  Duplicates are idempotent; the owner later re-pushes and gets its own ack. This keeps today's
  "any tab pushes every row" (S5 §7.16) for rows no live owner is delivering.

Storage names (rollback-safe):

- The WAL stays in `macro-document-wal` at **version 1**, store `updates`, with no new index and
  no version bump. New rows are `{scopeId, update, delivered, createdAt, owner, seq, user,
  foreign}`. Old bundles ignore the extra fields and keep pushing every undelivered row, which
  is harmless. A web rollback, a stale cached bundle, or a Tauri OTA bundle below the new one
  therefore still sees and delivers new rows.
- The per-row `delivered` flag stays the durable form; `delivered_through` is derived (§1.6).
- Old bundles' `pruneDelivered` may delete new delivered rows. That is safe: they are on the
  server.
- The snapshot DB stays `macro-document-snapshots` with an optional `covers` field. An old tab
  that overwrites it without `covers` makes `covers_for` 0, so the core prunes nothing and
  replays every remaining row, which is safe.

### 3.6 Which store where

| Host | WAL + snapshot executor |
| --- | --- |
| Web (default) | IndexedDB adapter in the TS executor (`§4.4`), keeping `RecoverableDatabase`'s reopen-on-terminate and the single rolled-back-append retry |
| Web (option) | Turso in the existing cache worker via `doc_store_turso` compiled into `cache-wasm`, by `postMessage`. **Not recommended** for M3: it adds a worker hop on the WAL path, and IndexedDB is already proven. Revisit if the cache worker becomes the single storage owner. |
| Tauri desktop and mobile webviews (M3) | The IndexedDB executor, as on web: Tauri runs the web bundle (§5). A native Turso store for Tauri comes only through S9 Phase 1, a plugin that executes these `StorageOp`s, gated by `MIN_NATIVE_BUILD`. |
| iOS / Android native-view editors | `doc_store_turso` inside `document_session_ffi` (§5), on the wrapper's own serial background queue; completions re-enter as later `FfiInput::Storage` calls, never inside the triggering `handle`. Swift and Kotlin never see `StorageOp`. |
| ai-editing-worker, lexical tests | `Persistence::Memory` |

---

## 4. `document_session_wasm`

### 4.1 Exported surface

```ts
// Generated by wasm-bindgen; one class per surface.
export class EditorSession {
  /** `config` is bebop `SessionConfigMsg` (§4.2). Throws `AbiMismatch` unless `abiMajor`
   *  (the generated `ABI_MAJOR` in the JS glue) equals the wasm's; throws on invalid config. */
  static create(abiMajor: number, config: Uint8Array, now: number, wall: number): EditorSession;

  // Hot path: primitives only, no encoding, no allocation on either side. Returns OutputFlags.
  /** selKind: 0 = Range inside `key`, 1 = KeepModel, 2 = None. flags bit 0 = composition_end.
   *  Anchor or focus outside `key`, and Node selections, go through `input()`. */
  textFromView(key: number, text: string, anchorOffset: number, focusOffset: number,
               selKind: number, flags: number, compositionData: string | undefined, now: number): number;
  selectionFromView(anchorKey: number, anchorOffset: number, anchorType: number,
                    focusKey: number, focusOffset: number, focusType: number, now: number): number;
  compositionStart(key: number, offset: number, now: number): number;
  compositionEnd(key: number, text: string, data: string | undefined, now: number): number;
  command(code: number, a: number, b: number, text: string | undefined, now: number): number;
  // R2.1 (S12 §0.2, §1.4-1.9): composition and keydown as hot primitives. `kind` is a
  // `CompositionKind` code; `routed` is the view's `$handleKeyDown` routing (a command code or
  // 0). Strings cross as UTF-16 and are decoded with `lexical_model::text_from_utf16` (S1 §11.4).
  composition(kind: number, key: number, text: string | undefined, anchorOffset: number,
              focusOffset: number, data: string | undefined, now: number): number;
  keyDown(code: number, mods: number, routed: number, key: string, now: number): number;

  // Cold path: any other SessionInput as bebop `SessionInputMsg` (commands with payloads,
  // Node and table selections (`ViewSelection::Table`), `SelectionChangeContext` with
  // `triple_click`, paste with `ClipboardPayload::html_nodes` from the view's html-import,
  // SetState, comments, flush, stop).
  input(msg: Uint8Array, now: number, wall: number): number;

  // I/O completions (each one call, each returns OutputFlags). Frames and text are hot and take
  // `now` only; every other completion is cold and also takes `wall`.
  socketOpened(conn: number, now: number, wall: number): number;
  socketFrame(conn: number, frame: Uint8Array, now: number): number;
  socketText(conn: number, text: string, now: number): number;
  socketClosed(conn: number, code: number, clean: boolean, now: number, wall: number): number;
  tokenFetched(attempt: number, token: string | undefined, access: number, now: number, wall: number): number; // undefined = failed; access decoded from claims
  storageDone(op: number, ok: boolean, failure: number, now: number, wall: number): number;
  storageLoaded(op: number, msg: Uint8Array | undefined, failure: number, now: number, wall: number): number; // bebop LocalStateMsg
  storageAdopted(op: number, adopted: number, failure: number, now: number, wall: number): number;
  chatter(kind: number, data: Uint8Array, now: number, wall: number): number;
  host(signal: number, now: number, wall: number): number;
  authorization(current: boolean, canWrite: boolean, canComment: boolean, now: number, wall: number): number;
  tick(now: number, wall: number): number;

  /** Copies the pending output out of wasm memory (memory growth detaches views). */
  takeOutput(): Uint8Array;
  /** The earliest deadline in ms on the `now` scale, or -1. Read when WAKE_CHANGED is set. */
  wakeAt(): number;

  // Bulk queries (SCOPE §3.4 rule 5: no per-node crossings).
  textContent(): string;
  markdown(flavor: number): string;
  nodeText(key: number): string;
  /** Bebop `QueryMsg` in, `QueryReplyMsg` out (S12 §1.14: html, selectionMarkdown, find,
   *  wordCount, `nodesOfType` = `Read::nodes_of_type_index` + `Read::export_json` per key,
   *  keyForNodeId, metadata). */
  query(msg: Uint8Array): Uint8Array;
  /** Bebop `ClipboardMsg` for copy/cut: html, lexical JSON and plain text (S12 §1.9). */
  clipboard(kind: number): Uint8Array;
  /** `Registry::type_table()` as bebop; per-instance rows carry no flags (S1 §4.1). */
  typeTable(): Uint8Array;
  /** `Editor::listener_table()` as bebop; read once after `create`: production plugins register at build (S1 §14.2). */
  listenerTable(): Uint8Array;
  // Dev builds only (S12 §5): a hash of the rendered tree, and EVT-14 through
  // `Read::should_prevent_default_and_insert_text`, for the view's cross-checks.
  debugViewChecksum(): number;
  debugShouldPreventDefault(key: number, offset: number, text: string): boolean;
  free(): void;
}
export class DocSession { /* create, input, read(path: Uint8Array): Uint8Array, the same I/O methods, takeOutput */ }
export class SyncRouter { /* routed transport: attach/detach, the same socket methods; returns per-doc
                             RouteEvents that the executor hands to sessions via input() */ }
```

Time: `now` is `performance.now()` relative to the executor's `t0`, which is the origin passed to
`create`: the executor is constructed first and calls `create(config, executor.now(),
Date.now())`. `wall` (`Date.now()`) is passed on `create`, `input`, `tick`, `host` and every cold
completion, and each one re-bases `wall_origin = wall - now`. Hot calls (keystrokes, selection,
commands, socket frames and text) compute `wall = wall_origin + now`. That avoids a second
`f64` on every keystroke while still correcting the drift after a suspend: `performance.now()`
may pause while the machine sleeps, and presence timestamps would otherwise fall outside peers'
timeout window (P-1). `visibilitychange → visible` always reaches the session as `host(Visible,
now, wall)` before any hot call.

`OutputFlags` bits:

| Bit | Meaning |
| --- | --- |
| 0 | `VIEW` |
| 1 | `IO` |
| 2 | `WAKE_CHANGED` |
| 3 | `NEED_PEER_IDS` |
| 4 | `ERROR` |

`0` means nothing to do, which is the common keystroke result: presence is coalesced into the
window (P-2), so a keystroke emits no I/O. JS calls `takeOutput()` only when a flag other than
`WAKE_CHANGED` is set. `WAKE_CHANGED` is read through `wakeAt(): number` (`-1` for none). The
keystroke is one call, plus a `wakeAt()` read on the first key of a window. IME composition
stays on this path (`compositionData`, `flags`), so Android Gboard and iOS typing never falls
back to `input()`.

### 4.2 Output encoding

Three encodings, chosen by cost and by drift risk (R2; no postcard crosses JS↔wasm):

1. **Hot inputs: wasm-bindgen primitives** (`textFromView`, `selectionFromView`,
   `compositionStart/End`, `command`, `socketFrame`, `socketText`, `tick`). The generated
   `.d.ts` makes them compile-checked; raw calls cost 5–30 ns (`notes-bench.md`).
2. **View diff: `lexical_model`'s flat format** (S1 §11.3): the `u32` word stream plus a UTF-8
   string table with its own `DIFF_FORMAT` version word (0.25–0.32 µs/node with a lazy
   `TextDecoder`, vs 0.51 µs serde-wasm-bindgen and 0.67 µs JSON).
3. **Everything else: bebop**, from one schema `crates/client/document_session_wasm/abi/session.bop`.
   `bebopc` generates `packages/collaboration/src/session/abi.generated.ts` and the Rust side;
   both are checked in, as `sync_protocol`'s are, and CI fails if they are stale.
   Little-endian, fixed-width scalars, `uint64` as `bigint`. Blobs stay in the raw payload slot
   unless the fixture test proves the TS runtime reads `byte[]` as a `subarray` view.
   - `lexical_model::Input` gets **no** wire encoding. `session.bop` defines `EditorInputMsg`, a
     union of only what JS sends cold (commands with payloads, composition edge cases, Node
     selection, `SetState`); `document_session_wasm` maps it to `Input` by hand, as an adapter.
   - `session.bop` (owned here, R2.1) also declares `const uint32 ABI_MAJOR`, `const uint32
     DIFF_FORMAT_VERSION` and `enum DiffOpcode : uint32` mirroring S1 §11.3.
     `document_session_wasm` asserts at compile time that `lexical_model::DIFF_FORMAT_VERSION`
     equals the generated constant, and a unit test checks every `lexical_model::DiffOpcode`
     against the generated enum (S1 §11.4). The `Input`/`Output` round trip lives here too, as
     the bebop test `session_bop::input_output_round_trip` (S4's former postcard `api_shape`
     test).
   - Hot inputs build `Input` from primitives directly (`NodeKey::from_parts`, `Utf16Offset`,
     `text_from_utf16`); a lone surrogate returns `Err(LoneSurrogate)` and the view re-renders.
   - Editor effects that cross: `SetViewSelection { selection, format, style }` (S1 §15),
     `ScrollIntoView`, `DecoratorsChanged`, `HistoryState`, `SelectionChange`,
     `PreventDefault`, `ScheduleRemoveEmptyText`, view-facing `PluginEvent`s, as tag 16
     `ViewEffect` payloads.
   - Recursive `DocValue` crosses as a preorder array `DocValueNode { byte kind; string key;
     float64 num; int64 int; string str; byte[] bytes; uint32 children; }`; the schema stays
     non-recursive.

```
u32 magic = 0x4D534553 ('MSES') | u16 abi_major | u16 abi_minor
u32 diff_format | u32 view_words | u32 string_bytes | u32 io_count
u32[view_words]            view: lexical_model flat opcodes
u8[string_bytes] (pad 4)   UTF-8 string table, (offset,len) refs from view
io_count × { u32 tag | u32 a | u32 b | u32 len | u8[len] (pad 4) }
```

| tag | effect | a | b | payload |
| --- | --- | --- | --- | --- |
| 1 | `FetchToken` | attempt | — | doc id (always) |
| 2 | `SocketConnect` | conn | — | bebop `ConnectMsg{doc, token, traceparent}` |
| 3 | `SocketSend` | conn | — | one frame, raw |
| 4 | `SocketPing` | conn | — | — |
| 5 | `SocketClose` | conn | code | — |
| 6 | `Storage` | op id (u32) | kind | bebop `StorageOpMsg` header, then the row/snapshot `bytes` raw |
| 7 | `ChatterPost` | kind | — | bytes, raw |
| 8 | `Telemetry` | — | — | bebop `TelemetryMsg` |
| 16 | `ViewEffect::Status` / `Presence` / `Reply` / `Error` / `DocChanged` | kind | request | bebop |

**Versioning.** `ABI_MAJOR` is a `const` in `session.bop`, generated into both languages;
`create()` throws `AbiMismatch` on a major mismatch, a loud failure with no fallback.
`abi_minor` is informational; within a major, union variants and struct fields are only
appended. That suffices because no production boundary crosses versions: the wasm and its JS
glue ship in one bundle (web, Tauri OTA), and nothing persisted uses the ABI (IDB rows are JS
objects the adapter writes; Turso rows are written by `NativeStoreExecutor`). A fixture test
round-trips every message Rust → bytes → TS → bytes → Rust and requires byte equality; S8's
bench tier and the §9.2 executor-trace suite run through the real wasm ABI in node. The view
opcodes and their decoder belong to S1. S8's `sim_peer_protocol` keeps its own serde `Wire*`
types (Rust↔Rust postcard, JSON for the TS peer); that is a test protocol, not this ABI.

### 4.3 How the JS executor works

The rules are few:

1. **Single-threaded, never re-entrant.** Effects are executed after `takeOutput()` returns.
   Completions that arrive later (IDB, socket, timer) call into the session from their own
   tasks. An input produced synchronously while executing (none are expected) is queued and
   drained afterwards.
2. **Dumb I/O.** The executor builds URLs, opens sockets, writes IndexedDB, posts to
   BroadcastChannel, and keeps one timer. It decides nothing about retries, backoff,
   ordering or what to send.
3. **The view is applied before I/O**, so a frame is painted before a slow `send`.
4. **Per-doc storage FIFO** (SC-2), and no storage op runs before the session's Web Lock
   `macro-wal:{doc}:{session}` is granted (SC-9): the queue starts behind the lock request.
5. **Tauri transport duties** (S5 §2.6), all in the executor's platform socket, not the core:
   dedupe by `seq`, `recover({after})` on visible, a replay gap → fail the connection
   (`socketClosed(1006)`), and close while CONNECTING. On `visible` the executor runs the Tauri
   `recover` first and only then calls `host(Visible)`, so the signal never races the recover.

```ts
// packages/collaboration/src/session/executor.ts (sketch). `packages/collaboration` owns the
// executor, its vitest project and `abi.generated.ts`; the wasm glue comes from §4.6's path.
import { EditorSession } from '@app/core/document-session/wasm/document_session_wasm';
import { SERVER_HOSTS } from '...';           // URLs come from servers.ts (config rule)

export class SessionExecutor {
  private sockets = new Map<number, WebSocket>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private channel: BroadcastChannel;
  private storageQueue: Promise<void> = Promise.resolve();
  private readonly t0 = performance.now();
  private readonly session: EditorSession;

  constructor(
    createSession: (now: number, wall: number) => EditorSession, // EditorSession.create(ABI_MAJOR, config, now, wall)
    private readonly view: ViewApplier,          // reconciler over Diff opcodes
    private readonly storage: StorageAdapter,    // IndexedDB adapter (§4.4), queued behind the Web Lock
    private readonly auth: DocumentSyncAuthorization,
    docId: string,
  ) {
    this.session = createSession(this.now(), Date.now());   // same origin as every later `now`
    this.channel = new BroadcastChannel(`macro-loro-${docId}`);
    this.channel.onmessage = (e) => this.run(this.session.chatter(chatterKind(e.data), e.data.data, this.now(), Date.now()));
    addEventListener('online', () => this.run(this.session.host(Host.Online, this.now(), Date.now())));
    document.addEventListener('visibilitychange', () =>
      this.run(this.session.host(document.visibilityState === 'visible' ? Host.Visible : Host.Hidden, this.now(), Date.now())));
    addEventListener('pagehide', () => this.run(this.session.host(Host.PageHide, this.now(), Date.now())));
    auth.onInvalidated(() => this.run(this.session.authorization(false, false, false, this.now(), Date.now())));
  }

  now = () => performance.now() - this.t0;

  /** Every session call goes through here. */
  run(flags: number): void {
    if (flags & Flag.WakeChanged) this.rearm(this.session.wakeAt());
    if ((flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)) === 0) return;
    const out = decodeOutput(this.session.takeOutput());
    this.view.apply(out.view, out.strings);                       // DOM first
    for (const effect of out.io) this.execute(effect);
    if (flags & Flag.NeedPeerIds) this.run(this.session.input(encodeAddPeerIds(randomPeerIds(4)), this.now(), Date.now()));
  }

  private execute(e: IoEffect): void {
    switch (e.tag) {                                              // ts-pattern match in real code
      case Io.FetchToken:
        void this.auth.getToken().then(
          (token) => this.run(this.session.tokenFetched(e.a, token, accessFromClaims(token), this.now(), Date.now())),
          () => this.run(this.session.tokenFetched(e.a, undefined, 0, this.now(), Date.now())));
        return;
      case Io.SocketConnect: {
        const { doc, token, traceparent } = decodeConnect(e.payload);
        const url = `${SERVER_HOSTS.sync_ws}/document/${doc}/connect?token=${token}` +
          (traceparent ? `&traceparent=${encodeURIComponent(traceparent)}` : '');
        const ws = platformWebSocketFactory(url);                 // browser or Tauri, unchanged
        ws.binaryType = 'arraybuffer';
        const conn = e.a;
        ws.onopen = () => this.run(this.session.socketOpened(conn, this.now(), Date.now()));
        ws.onmessage = (m) => this.run(typeof m.data === 'string'
          ? this.session.socketText(conn, m.data, this.now())
          : this.session.socketFrame(conn, new Uint8Array(m.data), this.now()));
        ws.onclose = (c) => { this.sockets.delete(conn); this.run(this.session.socketClosed(conn, c.code, c.wasClean, this.now(), Date.now())); };
        this.sockets.set(conn, ws);
        return;
      }
      case Io.SocketSend: this.sockets.get(e.a)?.send(e.payload); return;
      case Io.SocketPing: this.sockets.get(e.a)?.send('ping'); return;
      case Io.SocketClose: closeOrAbandon(this.sockets.get(e.a), e.b);   // CONNECTING: close on open
        return;
      case Io.Storage:
        this.storageQueue = this.storageQueue.then(async () => {
          const result = await this.storage.execute(e.b, e.payload);  // never throws; returns a code
          this.run(match(result)                                   // ts-pattern
            .with({ kind: 'loaded' }, (r) => this.session.storageLoaded(e.a, r.payload, r.failure, this.now(), Date.now()))
            .with({ kind: 'adopted' }, (r) => this.session.storageAdopted(e.a, r.adopted, r.failure, this.now(), Date.now()))
            .with({ kind: 'done' }, (r) => this.session.storageDone(e.a, r.ok, r.failure, this.now(), Date.now()))
            .exhaustive());
        });
        return;
      case Io.ChatterPost: this.channel.postMessage(chatterMessage(e.a, e.payload)); return;  // {type, data}
      case Io.Telemetry: forwardTelemetry(e.payload); return;   // @macro-inc/observability
    }
  }

  private rearm(at: number): void {
    clearTimeout(this.timer);
    if (at < 0) return;
    this.timer = setTimeout(() => this.run(this.session.tick(this.now(), Date.now())), Math.max(0, at - this.now()));
  }
}
```

### 4.4 IndexedDB adapter

`StorageAdapter.execute(kind, payload)` maps each `StorageOp` to one IDB transaction over the
existing v1 stores (`macro-document-wal` / `updates`, keyed by autoincrement `id` with the
`scopeId` index; `macro-document-snapshots`). No new database, store, index or version:

- `Load`/`LoadOrphans` scan the doc's rows through the `scopeId` index and classify each row:
  no `owner` → `Legacy` orphan; owner's Web Lock free (`navigator.locks.query()`) and same
  `user` → orphan; owner live and same `user` → `assist` (undelivered only); other `user` →
  skipped. A snapshot with `byteLength == 0` is returned as `None`.
- The adapter keeps, per session, `seq → primary key` for the rows it appended (the session
  owns its owner's rows exclusively under the Web Lock), so the hot ops never scan:
  - `WalAppend` checks that map for `(owner, seq)` (SC-6), then `add`s `{scopeId, update,
    delivered: false, quarantined: false, createdAt, owner, seq, user, foreign}`. Only a
    `retry: true` append (the re-emit after `Uncertain`) scans, with `openCursor` on `scopeId`
    reading `owner`/`seq` only, never cloning `update` bytes;
  - `WalMarkDelivered{through}` updates the owner's rows with `seq ≤ through` by primary key in
    one readwrite transaction;
  - appends issued from `Hidden`/`PageHide`/`Stop` call `tx.commit()` explicitly.
  The `Load` and `WalAdopt` scans happen once per open; adopted rows enter the map.
- `WalQuarantine` sets `quarantined = true` by primary key; it deletes nothing.
- `WalAdopt` rewrites `owner`/`seq` in place in one transaction, row by row conditional on
  `owner == from` (a missing `owner` for `Legacy`), and deletes the from-owner's delivered,
  covered rows (§1.6). It is atomic for legacy rows too; there is no copy-then-delete.
- `WalPrune` and `WalDropExpired` are cursor deletes in one transaction.
- It keeps `RecoverableDatabase` (reopen on terminate) and the single rolled-back-append retry
  (SC-3). An abort whose commit status is unknown is reported as `Uncertain`. It never wipes
  (SC-5) and adds no other logic.

### 4.5 What JS keeps

- The reconciler that applies `Diff`, and DOM selection ↔ points.
- IME, `beforeinput` and the event heuristics.
- Decorators and remote-cursor rendering (DOM rects, from `ViewEffect::Presence` plus the
  `nodeText`/rect queries).
- The token fetch.
- The 750 ms form publish.

Gone from the web bundle:

- `loro-crdt` (the Rust core *replaces* it; SCOPE risk);
- `loro-mirror`;
- `SyncEngine`, `WALSyncer`, `LoroManager`, `SyncServiceSource` and `SyncRouterTransport`;
- `websocket/core/*` (keep only the platform factory and Tauri transport);
- `awareness.ts`, `reconcile.ts`, `mapping.ts` and most of `cursor.ts`.

Non-editor blocks (psd, fig, pptx, docx, spreadsheet, canvas, ai, forms, collab surfaces)
move to `DocSession` one block at a time. Until a block moves, its `loro-crdt` import keeps
the second Loro alive, loaded lazily (§4.6). See risk R-2.

### 4.6 Packaging and loading (R2)

The new wasm follows the repo's one pattern for app wasm (`apps/web/justfile`,
`apps/web/AGENTS.md` "Desktop release builds"). WP-53 carries these as acceptance checks.

- **Build.** `build-document-session-wasm` in `apps/web/justfile`:
  `scripts/cached-wasm-build.sh document_session_wasm {{justfile_directory()}}/src/lib/core/document-session/wasm
  -- env CARGO_TARGET_DIR=… wasm-pack build ../../crates/client/document_session_wasm --target web
  --release --out-dir {{justfile_directory()}}/src/lib/core/document-session/wasm` (output
  gitignored), plus an `ensure-document-session-wasm` dev fast path that rebuilds when the crate
  or any workspace crate in its dependency closure is newer than the artifact. It joins the
  `[parallel] build-wasm` list. `cargo x deps` runs after the crate lands so
  `.github/workspace-dep-closures.json` keys the cache. There is no
  `@macro-inc/document-session-wasm` package; the executor imports the generated glue by path.
- **Desktop.** `nix/tauri-desktop.nix` `coreWasmPackages` gains `{ name = "document_session_wasm";
  crate = "crates/client/document_session_wasm"; dir = "document-session"; }`, because desktop
  releases run Vite directly and never call `build-wasm`; the existing asset check over
  `coreWasmPackages` then fails a release that lacks it. Do not set
  `CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS` (e.g. for SIMD) in that derivation without
  re-adding `--cfg getrandom_backend="wasm_js"`, which it would otherwise replace. `build-tauri-dev`
  (iOS simulator previews) builds this package too.
- **Startup.** While M3 is behind its flag, `HTML_PRELOADS` in `apps/web/vite.base.ts` keeps the
  `loro_wasm_bg-*.wasm` preload, and flagged users start fetching the session wasm from the flag
  bootstrap, in parallel with app boot. When the flag ships default-on, the session wasm takes
  **Loro's preload slot** (`document_session_wasm_bg-*.wasm`, `as: 'fetch'`,
  `type: 'application/wasm'`), and `loro-crdt` becomes a dynamic import loaded on the first
  unmigrated block (S7 R-2). Preloading both would add ~738 KB br to every page. The module
  initializes on the **main thread** with streaming instantiate before the editor mounts.
- **iOS.** Never instantiate it in a Worker (every keystroke would become async, and eager
  module workers deadlock WKWebView). Any worker the executor ever adds is constructed lazily
  (`apps/web/AGENTS.md` iOS gotcha).
- **Size.** CloudFront rejects files over 10 MB. Loro alone is ~3.1 MB raw. The budget for
  `document_session_wasm_bg.wasm` after `wasm-opt` (session + model + Loro + markdown + Macro
  nodes) is ≤ 6 MB raw, and the S4 §5.4 size gate fails at 8 MB on this exact artifact.
- **ai-editing-worker (M4).** workerd imports `.wasm` as a compiled module, so the worker uses
  the `--target web` glue with `initSync({ module })` over `import wasm from
  './document_session_wasm_bg.wasm'`, built by a `build-document-session-wasm` recipe in the
  worker's own justfile. Loro on wasm32 calls `Date.now` through wasm-bindgen
  (loro-internal `change.rs:303-318`), which needs a JS host; workerd is one.
- **CI.** A `document-session` path filter (`crates/client/doc_sync_core/**`,
  `crates/client/document_session*/**`, `crates/sync_protocol/**`, `apps/web/justfile`,
  `apps/web/vite.base.ts`, `nix/tauri-desktop.nix`) runs the size gate, `just
  build-document-session-wasm`, the ABI staleness check (§4.2) and the desktop
  `coreWasmPackages` presence check.

### 4.7 Observability of the new flows (R2)

Per `.agents/rules/observability.md`: one trace from the user's action through every service,
phases timed, ids as fields, no content, prompts, tokens or personal data (user ids are opaque
`UserKey`s, never emails). Web spans go through the `@macro-inc/observability` `Telemetry`
facade; native maps `TelemetryRecord` to `tracing`. Keystrokes are never spanned.

| Span or event | Where | Parent | Fields |
| --- | --- | --- | --- |
| `doc.open` (reference lifecycle) gains child `wasm.init` | executor | `doc.open` | `bytes`, `cached`, `compile_ms`, `instantiate_ms` |
| `editor.open` with phases `session.create`, `state.load`, `view.initialize` | executor + `TelemetryRecord` | `doc.open` | `document.id`, `session.id`, `seed.kind`, `nodes`, `bytes` |
| `editor.paste`, `editor.markdown_export`, `editor.set_state` | `TelemetryRecord` from the surface | the UI action's span | `bytes`, `nodes`, `outcome` |
| `editor.undo` (only groups over 100 ops) | surface | UI action | `ops`, `outcome` |
| `doc.seed`, `doc.sync.catchup`, `edit.apply`, `doc.sync.connect`, `doc.sync.reset` | core | §1.5 parent rule | unchanged |
| `doc.sync.rebase` (new, I-2') | core | root, linked to the failing import's span | `cause` (`live`/`catchup`/`chatter`/`replay`), `rows_replayed`, `ms` |
| `wal.delivery_outage{suspect}` (span) with child `wal.probe` | core | the session span | `seq`, `not_acked`, `verdict` (`transient`/`poison`/`gap`) |
| `wal.poison`, `wal.gap`, `wal.expired`, `peer.assigned` (events) | core | current span | `owner`, `seq`/`seqs`, `bytes`, `reason`, `purpose` |
| `doc.snapshot.save` | core (S-1) | session span | `bytes`, `ms`, `deferred_ms` |
| `ws.message.error{stage}` (event) | core (§1.4) | `doc.sync.connect` | `stage`, `conn` |
| `doc.storage.<op>` (`wal_append`, `load`, …) | executor (IDB) / `NativeStoreExecutor` | the span key carried in `StorageOpMsg.span` | batch size, bytes, outcome, `retry` |

- **Hops.** The socket carries `traceparent` on every connect, built from the current
  `doc.sync.connect` span, which the server's `do.request` adopts (S6 E3); a reconnect gets a
  fresh connect span. Chatter between tabs cannot carry context (the message shape is fixed for
  old tabs), so the importing side records `chatter.source_session` from `Closing` or the row
  owner. Storage effects carry the issuing span key so executor spans join the session's trace.
- **ai-editing-worker (M4).** The `edit.*` taxonomy (`edit.session`) is unchanged; the only new
  span is `wasm.init` under `edit.session`.
- **Check.** Each M2–M4 work package's acceptance includes running the flow locally and finding
  it as one connected trace in local Tempo (`live-debug` skill), findable by `document.id` and
  `session.id`.

---

## 5. `document_session_ffi` (uniffi)

```rust
#[derive(uniffi::Object)]
pub struct NativeEditorSession { inner: std::sync::Mutex<NativeHost<EditorSurface>> }

/// Executes storage in-process with `doc_store_turso` when configured.
/// Everything else goes back to the host.
struct NativeHost<S: Surface> { session: DocumentSession<S>, store: Option<doc_store_turso::Store> }

#[uniffi::export]
impl NativeEditorSession {
    #[uniffi::constructor]
    pub fn new(config: FfiSessionConfig, store_path: Option<String>, now: FfiNow) -> Result<std::sync::Arc<Self>, FfiSessionError>;

    /// One input in, every effect the host must execute out. Never performs I/O. When
    /// `store_path` was given, storage effects never appear here: the wrapper enqueues them on
    /// its own serial background queue (`NativeStoreExecutor`), and each completion re-enters
    /// as a later `FfiInput::Storage` call issued by the wrapper, never inside this call.
    pub fn handle(&self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError>;

    pub fn text_content(&self) -> Result<String, FfiSessionError>;
    pub fn markdown(&self, flavor: FfiMarkdownFlavor) -> Result<String, FfiSessionError>;
    /// Clipboard, bulk queries and the type table (S12 §3.9), as uniffi records.
    pub fn query(&self, request: FfiQuery) -> Result<FfiQueryReply, FfiSessionError>;
}

#[derive(uniffi::Record)] pub struct FfiNow { pub mono_ms: u64, pub wall_ms: i64 }

#[derive(uniffi::Enum)]
pub enum FfiInput {
    TextFromView { key: u32, text: String, anchor: FfiPoint, focus: FfiPoint, composition_end: bool, composition_data: Option<String> },
    SelectionFromView { anchor: FfiPoint, focus: FfiPoint },
    Command { command: FfiCommand },              // payloads carry `FfiModifyTarget` where S1's do
    // R2.1 (S12 §3.9): native view inputs.
    Composition { kind: FfiCompositionKind, key: u32, text: String, anchor: FfiPoint, focus: FfiPoint, data: Option<String> },
    KeyDown { key: String, code: u32, modifiers: u32, routed: Option<FfiCommand> },
    Paste { payload: FfiClipboardPayload }, Undo, Redo,
    SocketOpened { conn: u32 }, SocketFrame { conn: u32, frame: Vec<u8> },
    SocketText { conn: u32, text: String }, SocketClosed { conn: u32, code: u16, clean: bool },
    Token { attempt: u32, token: Option<String>, access: FfiWriteAccess },
    Storage { op: u32, result: FfiStorageResult },      // from the host, or from the wrapper's store queue
    Host { signal: FfiHostSignal }, Authorization { current: bool, can_write: bool, can_comment: bool },
    Comment { request: u32, mark: FfiCommentMark }, Flush { request: u32 },
    AddPeerIds { ids: Vec<u64> }, Tick,
}

#[derive(uniffi::Record)]
pub struct FfiOutput { pub view: Vec<FfiViewEffect>, pub io: Vec<FfiIoEffect>, pub wake_at_ms: Option<u64>, pub need_peer_ids: bool }

#[derive(uniffi::Enum)]
pub enum FfiViewEffect {
    Diff { ops: Vec<FfiDiffOp> }, SetSelection { anchor: FfiPoint, focus: FfiPoint },
    ScrollIntoView { key: u32 }, Status { status: FfiSyncStatus }, Presence { peers: Vec<FfiPeerPresence> },
    Reply { request: u32, reply: FfiReply }, Error { error: FfiSessionError },
    Decorators { keys: Vec<u32> }, HistoryState { can_undo: bool, can_redo: bool }, /* … */
}
#[derive(uniffi::Enum)]
pub enum FfiIoEffect {
    FetchToken { attempt: u32, doc: String }, SocketConnect { conn: u32, url_path: String, token: String, traceparent: Option<String> },
    SocketSend { conn: u32, frame: Vec<u8> }, SocketPing { conn: u32 }, SocketClose { conn: u32, code: u16 },
    Storage { op: u32, op_body: FfiStorageOp },          // only without store_path
    Telemetry { record: FfiTelemetry },
}

#[derive(uniffi::Object)] pub struct NativeDocSession { /* same shape over GenericSurface, plus read(path) */ }
```

- The native sessions build their editor with `view_host(ViewHost { engine: ViewEngine::Native,
  os })` (S1 §15): no composition characters, `os` from the device.
- Native diffs are structured enums, not `u32` words, because calls across uniffi are cheap
  compared with layout.
- **Encoding (R2).** uniffi records only; the FFI never uses bebop or postcard. Swift and
  Kotlin have no bebop generator, and uniffi's contract version plus per-API checksum, checked
  at library load, is the versioning: bindings and staticlib ship in one native build.
- The `Mutex` serializes calls from the host's sync thread and its UI thread. Hosts must
  call from one serial queue anyway, as the web does. Because `handle` never runs Turso, the
  mutex is never held across an fsync (S9 append p99 4.5 ms, open 77–217 ms); a cold open's
  `Load` runs on the store queue, not the caller's thread.
- There is no chatter on native: one process holds one session per doc.
- The Tauri apps run the **web** bundle (wasm in WKWebView/WebView). The FFI is for
  native-view editors only (SCOPE M5).
- iOS rule: the session runs on the main thread as wasm in Tauri, and **must not** go to a
  Worker. A Worker makes every keystroke async, and eager module workers deadlock WKWebView.

---

## 6. Every behaviour of today's stack, mapped

The file is under `packages/collaboration/src/` unless it says otherwise. "≡" means the same
behaviour. "Δ" means a deliberate change.

| # | Today (file) | Behaviour | New home | |
| --- | --- | --- | --- | --- |
| 1 | engine.ts `start` | idempotent; refuses before the manager is initialized | `Start` idempotent; `Running` only after `Seeded` (S-3) | ≡ |
| 2 | engine.ts `subscribeLocalUpdates` → `wal.append` + `chatter.post` | one WAL row and one gossip message per Loro commit | W-1: one row per 25 ms window; gossip posted when an own row is durable, never for foreign rows (W-10.1, .4) | Δ |
| 3 | engine.ts `readonly()` | drops local updates | §2.2: read sessions never write Loro, so nothing to drop | ≡ (stronger) |
| 4 | engine.ts chatter subscribe | update → import, awareness → import | `SyncInput::Chatter` → I-1 / P-2 | ≡ |
| 5 | engine.ts `registerPeerId` on start | | "on synced" step 1; `registered_peers` (PE-3) | ≡ |
| 6 | engine.ts 5 s `persistSnapshot` | `wal.flush()`, shallow snapshot at oplog frontiers, `pruneDelivered` after save, every 5 s | S-1 (only when the oplog vv changed), W-9 with `covers` | Δ (conditional tick, exact prune) |
| 7 | engine.ts `start` → `convergeFromServer` | | C-1 | ≡ |
| 8 | engine.ts `stop` | unsubscribe, clear interval, presence `undefined` and push | `Stop` | ≡ |
| 9 | engine.ts `syncStateToLoro` error → `reset` | | projection error → I-2 | ≡ |
| 10 | engine.ts `syncAwarenessToLoro`, `onLocalAwarenessChange` | push local presence + chatter on every change | `SetPresence` → P-2, coalesced to one send per 25 ms window | Δ (≤ 40 Hz, same wire bytes) |
| 11 | engine.ts `reset` | stop, flush unsent, snapshot, replace, restart, push new state under lock | I-3; `Replaced` → `ViewEffect::Initialize` | ≡ |
| 12 | engine.ts `reset` failure | restart on old doc | I-3 failure path | ≡ |
| 13 | engine.ts | resets loop forever on a persistently bad update | `reset_budget` → `Closed(Corrupt)` | Δ |
| 14 | engine.ts `onStateUpdate` | ignores TO_LORO and INITIALIZE echoes | gone: no JSON mirror, no echo | removed |
| 15 | engine.ts `handleRemoteUpdate` generation check | queued packet after stop is dropped | I-1 phase gate; `ConnId` | ≡ |
| 16 | engine.ts import `ImportPending` → converge, other error → reset | `ImportUpdatesThatDependsOnOutdatedVersion` also resets | C-1, I-2; `Outdated` → unbudgeted, rate-limited rebase (I-2') | Δ |
| 17 | engine.ts source events `incremental_snapshot` | imported as an update | I-1: consumed only by its FIFO-matched requester, never imported as an update | Δ (shallow snapshot into a doc with history is unsafe) |
| 18 | engine.ts `reconnect` event → converge `rerunIfInFlight` | | "on synced" step 2 | ≡ |
| 19 | engine.ts converge coalescing and rerun | | `Convergence.rerun`, C-5 | ≡ |
| 20 | engine.ts `REQUEST_UPDATES_MAX_ATTEMPTS=3`, 2 s delay | | `ConvergePolicy` | ≡ |
| 21 | engine.ts empty catch-up payload → noop | | C-3 | ≡ |
| 22 | engine.ts converge pending after reply | (implicit) re-converge on next pending import | C-3 bounded by `max_attempts` | Δ |
| 23 | engine.ts `syncLock` mutex | serializes async steps | single-threaded `handle` | removed |
| 24 | wal.ts `WALEntry{id, delivered, createdAt}` | per-row delivered flag | same v1 row plus `owner`, `seq`, `user`, `foreign`; per-row `delivered` stays durable, `delivered_through` derived (§1.6, §3.5) | Δ (extra fields only) |
| 25 | wal.ts `WAL_TTL_MS` 7 days at construction | drop expired undelivered, warn | W-7 (orphan and legacy rows at load) + `wal.expired` | ≡ |
| 26 | wal.ts `append` then `flush` | persist before push | W-2 | ≡ (Δ when storage failed) |
| 27 | wal.ts IDB abort retry once (`BrowserWALStore.append`) | | IndexedDB adapter (SC-3) | ≡ |
| 28 | wal.ts `isFlushing` + `hasNewPending` rerun | no concurrent flush; rerun for late rows | W-3, W-4 step 5 | ≡ |
| 29 | wal.ts push all undelivered in one batch | | W-3 | ≡ |
| 30 | wal.ts not-acked → `wal.delivery_outage` span, retry on next trigger | | W-5 | ≡ |
| 31 | wal.ts `markDelivered(ids)` | | `WalMarkDelivered{through}` | Δ |
| 32 | wal.ts `flushPending` waits for in-flight appends | | `Flush` (§2.4) | ≡ |
| 33 | wal.ts `reportFailure` dedupe per stage | | telemetry once per outage | ≡ |
| 34 | wal.ts `ready()` setup retried on demand | | `LocalLoad::Failed{retry_at}` | ≡ |
| 35 | wal.ts `createWALSyncSource` reconnect → flush | | "on synced" step 3 | ≡ |
| 36 | wal.ts shared scope per doc across tabs | everyone pushes everyone's rows | owned rows + adoption + assisted delivery (§3.5 O-1..O-5) | Δ |
| 37 | forms `FormWAL` unlogged rows in memory, save state | | `EntryState::Unlogged`, `SaveState` | ≡ (generalized) |
| 38 | snapshot-store.ts `IDBSnapshotStore` | save/load/delete by scope | `SnapshotSave/Load/Delete` | ≡ |
| 39 | snapshot-store.ts `loadCachedState` corrupt snapshot → delete | markdown's ingest never deleted one (S5 §7.17) | S-2 deletes for every surface | Δ (one rule for all surfaces) |
| 40 | snapshot-store.ts replay: pending → continue, error → stop | | W-8 per row: pending held, error → that row skipped and logged, replay continues | Δ (one bad row no longer hides later rows) |
| 41 | manager.ts `ingest` first-wins of optimistic/local/s3/dss | | S-2 | ≡ |
| 42 | manager.ts WAL replay only on a local seed | | W-8 on any seed | Δ |
| 43 | MarkdownDocument.tsx `ingestLocalSnapshot` re-saves after replay | | S-2 | ≡ |
| 44 | manager.ts `setRecordTimestamp(true)` | every commit, implicit ones included, carries system time | `record_timestamp` off; user commits `commit_with(now.wall_secs())`; implicit commits carry 0 (D-4a) | Δ (implicit commits lose their timestamp; needed for determinism) |
| 45 | manager.ts random peer per `LoroDoc` | | `PeerSupply` (PE-1) | ≡ |
| 46 | manager.ts `getUpdateSince` local spans only | | `SyncDoc::export_local` | ≡ |
| 47 | manager.ts `reset`: snapshot must be self-contained | | `SyncDoc::replace` | ≡ |
| 48 | manager.ts `createUndoManager` | | `EditorSurface.undo` (§2.2) | ≡ |
| 49 | source.ts `TIMEOUTS` | 10 s / 5 s / 10 s / 10 s | `Timeouts` | ≡ |
| 50 | source.ts heartbeat only after initial sync | | `AwaitingInitialSync` → `Synced` | ≡ |
| 51 | source.ts late `RemoteInitialSync` with no waiter | accept, heartbeat, reregister, emit reconnect | `AwaitingInitialSync` accepts at any time, and it now also seeds while `Loading` (S-2) | Δ |
| 52 | source.ts `pushUpdate` false before initial sync | | W-6 (`Synced` only) | ≡ |
| 53 | source.ts ack waiter attached before send; matched by id; out-of-order acks | | `Push::InFlight{id}` (one in flight, so id-matched out-of-order acks can no longer happen) | Δ |
| 54 | source.ts `cancelOnDisconnect` releases pending pushes | | `Closed` cancels the in-flight push (W-5) | ≡ |
| 55 | source.ts `commentOnly` → `PeerCommentUpdate` | | `PublishComment` (§2.5) | ≡ |
| 56 | source.ts `pushAwareness` only when open | | P-2 | ≡ |
| 57 | source.ts `reregisterPeerIds` on reconnect | | "on synced" step 1 | ≡ |
| 58 | source.ts `requestSnapshot` 10 s | | `RequestSnapshot(RequestId)` | ≡ |
| 59 | source.ts `requestUpdatesSince` byte-equal vv match | | C-2 | ≡ |
| 60 | source.ts `reconnect` only when down | | `Online`/`Visible` rows of the transition table | ≡ |
| 61 | source.ts pre-listener buffering; drop after detach | | dropped; convergence refetches (I-1) | Δ |
| 62 | source.ts `onClose` → `initialSyncReceived=false` | | leaving `Synced` | ≡ |
| 63 | source.ts `online` / `visibilitychange` listeners | | executor → `HostSignal` | ≡ |
| 64 | websocket.ts URL resolver per connect + generation guard | | `FetchToken`, `ConnId` | ≡ |
| 65 | websocket.ts `ExponentialBackoff(250, 5)`, 20 retries, reset on open | | `BackoffPolicy`, `GaveUp` | ≡ |
| 66 | websocket.ts give-up revived by online/visibility/user edit | | `GaveUp` revival | ≡ |
| 67 | websocket.ts `Reconnect` event when connected before | | `ever_synced` | ≡ |
| 68 | websocket.ts unbounded `ArrayQueue` send buffer | blind byte replay after reconnect | no byte buffer; intents re-derived on `Synced` | Δ |
| 69 | websocket.ts ping text, 5 s timeout, `missed > 2` → `close(1000)` | | `Heartbeat` | ≡ |
| 70 | websocket.ts pong resets missed | | ≡ | ≡ |
| 71 | websocket.ts heartbeat on closing socket → close handling | | the executor's `onclose` | ≡ |
| 72 | websocket.ts `reconnect` while `connectPending` → no-op | | `Authorizing`/`Connecting` are pending states | ≡ |
| 73 | websocket.ts abandoned `CONNECTING` socket closed when it opens | | executor `closeOrAbandon` | ≡ |
| 74 | websocket.ts URL-resolution failure → error + retry | | `Token::Failed` → `Backoff` | ≡ |
| 75 | websocket.ts no connect timeout | a stuck CONNECTING socket waits for the platform | `timeouts.connect` | Δ |
| 76 | framing `intoFrames`/`Reassembler` 900 000 B | strings bypass framing | `sync_protocol::frames`; ping/pong are text | ≡ |
| 77 | tauri-websocket.ts read error → error + close 1006 | | executor reports `Closed{1006}` | ≡ |
| 78 | helpers.ts initial token once, fresh per reconnect, fallback URL | | `initial_token`, `last_token`, `allow_token_fallback` | ≡ |
| 79 | helpers.ts `traceparent` query param | | `SocketConnect.traceparent` | ≡ |
| 80 | guarded-source.ts `isCurrent` false → cleanup, deny | | `Authorization{current:false}` → `Closed(Unauthorized)` | ≡ |
| 81 | guarded-source.ts `pushUpdate` while disconnected → reconnect, false | unguarded sources never revived on edit (S5 §7.1); guarded ones cancelled a pending backoff | `LocalChanged` revives only `GaveUp`, for every source; `Backoff` keeps its schedule (F40) | Δ |
| 82 | guarded-source.ts `canWrite` false → no push | | W-6 | ≡ |
| 83 | router.ts one shared socket, `RouterSubscribe` with token per doc | | `RouterCore` | ≡ |
| 84 | router.ts frames held until `RouterSubscribed` | | `Route::Subscribing.pending` | ≡ |
| 85 | router.ts resubscribe backoff 500 ms → 8 s | | `Route::Dropped` | ≡ |
| 86 | router.ts new owner on open route → resubscribe, others see close | | kept (§1.9) | ≡ |
| 87 | router.ts subscribe-failed 4401 / doc-closed 4000 | | `RouteEvent::Closed{code}` | ≡ |
| 88 | router.ts router reconnect → resubscribe all; heartbeat starts on first initial sync | | `RouterCore` | ≡ |
| 89 | router.ts reassembler per route reset on subscribe/close | | `Route::Open.reassembler` | ≡ |
| 90 | awareness.ts `EphemeralStore` timeout 10 s (markdown 5 s) | | `PresencePolicy.timeout`, `PresenceStore` | ≡ (wire) |
| 91 | awareness.ts value `{user:{userId,color,peerId}, selection}`, selection codec | | P-1; selection codec = `lexical_loro` cursor encoding | ≡ |
| 92 | awareness.ts remote list excludes self and empty selection | | P-2 | ≡ |
| 93 | awareness.ts random palette colour | | `PresenceUser.color` from config | ≡ |
| 94 | awareness.ts microtask hack for the subscribe bug | | gone | removed |
| 95 | chatter.ts `BroadcastChannel('macro-loro-'+doc)` `{type,data}` | | same shape, plus `Closing` | ≡ |
| 96 | CollabProvider `FLUSH_COLLABORATION_COMMAND` | write state, flush, resolve `dirty === 0` | `Flush` | ≡ |
| 97 | CollabProvider `didFirstSync` | no Loro writes before first sync | S-3 | ≡ |
| 98 | CollabProvider init empty vs versioned; strip drafts; `FORCE_SYNC` | | §2.2 Init | ≡ |
| 99 | CollabProvider `editorError` → stop | every commit was already appended | `Stop` from the host on an editor error; W-1 terminal append before close, `Reply::Stopped` | ≡ |
| 100 | CollabProvider code-highlight id pass | | gone (SCOPE D6) | removed |
| 101 | CollabProvider remote reconcile + selection restore from awareness | | §2.2 Remote | ≡ |
| 102 | CollabProvider loop-prevention tags (`from-loro`, `collaboration`, `local-status`) | | gone; local-status is excluded by the projection | removed |
| 103 | publishCommentMark.ts staged peer, refusals, comment-only push, import on ack | | §2.5 | ≡ (fewer steps) |
| 104 | spreadsheet/forms presence heartbeat 3 s while connected | | `PresencePolicy.refresh` | ≡ |
| 105 | forms save state `saved/saving/unsaved(undelivered|storage)` | | `SaveState` | ≡ |
| 106 | forms publish 750 ms after delivered edits | | app-level on `Status` | ≡ |
| 107 | spreadsheet `serializeSnapshotOperation` across mounts | | SC-2 | ≡ |
| 108 | ai-editing-worker `createNoopLiveSyncSource` + `InMemoryWALStore` | | `TransportKind::None` + `Persistence::Memory` | ≡ |
| 109 | MarkdownDocument.tsx S3 cached snapshot ingest | | `Seed{CachedS3}` from host | ≡ |
| 110 | source.ts / S5 §3.5, §7.18 | initial-sync awareness bytes never imported | "On synced" step 1a: imported on every `RemoteInitialSync`, presence only | Δ (new joiners see cursors at once) |
| 111 | engine.ts converge retry | retries reuse the original `since`; a non-error empty reply isn't retried | C-4: retries re-read `oplog_vv`; empty reply not retried | Δ (retry), ≡ (empty) |
| 112 | engine.ts `doc.sync.catchup` | always parents on the load span (S5 §7.19) | `TelemetryRecord` parent rule (§1.5): reconnect catch-up parents on `doc.sync.connect` | Δ (telemetry only) |
| 113 | ai-peer.ts `AI_PEER_BASE`/`isAiPeer`; worker presence (UUID key, `(AI)` label, 2 s keepalive, 700 ms linger, `encodeAll`); server `active_peers` filter (S6 H3) | | `PeerRange::Ai` (PE-4), `PresenceKeyMode::Fixed`, `PresencePolicy.refresh` | ≡ |
| 114 | ai-editing-worker propagating path (`SyncServiceSource` over a static URL, `InMemoryWALStore`, `edit.flush` fails loudly when unacked, `run-edit.ts:225-236`) | | **Stays on TS in M3.** `packages/collaboration`'s engine, WAL and source therefore survive outside the web bundle until the worker moves to `EditorSession`/`DocSession` wasm with `Direct` + `Memory` + `PeerRange::Ai` and `Flush` → `NotDrained` as the loud failure. Row 108's noop path moves with it. | ≡ (deferred) |
| 115 | tauri-websocket.ts (S5 §2.6) | seq dedupe, `recover({after})` on visible, replay gap → `failConnection`, close while CONNECTING | executor duties (§4.3 rule 5); `recover` runs before `host(Visible)` | ≡ |
| 116 | MarkdownDocument.tsx `hasLocalSnapshot` | requires `byteLength > 0` | `LocalState.snapshot` maps `Some(empty)` to `None` (S-2) | ≡ |
| 117 | sync-service close codes | 1008 (frozen/retired, surface revoked/expired, document deleted); 4401/4000 on routes | connection table: 1008 and repeated 4401 → `Closed(Unauthorized)` after a fresh-token retry; 4000 and others → `Backoff` | ≡ (made explicit) |
| 118 | framing (S5 §7.12) | client treated the final flag as `=== 1` | shared `Reassembler` adopts the server rule: final iff `!= 0`, an empty frame is an error | Δ (client only; server unchanged) |
| 119 | engine.ts `reset()` while not running (canvas); edits before `Running` | | I-2: `reset_requested` starts on `Running`; mutating input before `Seeded` → `Error(NotReady)` (§2.2) | ≡ |
| 120 | undo.ts `maxUndoSteps = 100`; empty-doc `groupStart` WASM panic guard (undo.ts:244) | | §2.2 Undo: `max_undo_steps = 100`; the empty-doc path returns `Err`, never panics (CS-57) | ≡ |
| 121 | wal.ts shared scope; any tab pushes every row (S5 §7.16) | covers frozen and old tabs | O-5 assisted delivery of live foreign rows; users never mixed (O-2) | ≡ (kept for frozen tabs) |
| 122 | — | — | W-10 chatter after durable own append + foreign rows (no echo, evidence-based delivery); W-11 poison proven locally, parked never deleted, then reset; W-3 256 KiB / 64-entry cap; W-6 access change and per-connection access; I-3 step 0 forced append; W-1 terminal append | Δ (new rules, no TS counterpart) |
| 123 | engine.ts `persistSnapshot` | shallow root at `oplogFrontiers()` | S-1/S-1': root at the last converged base; save skipped while an own entry is `Unlogged`; deferred while typing | Δ |

---

## 7. Typing-speed budget (SCOPE §3.4 restated for the session)

| Per keystroke | Today (500 KB doc) | Session |
| --- | --- | --- |
| wasm/JS calls | n/a (all JS) | 1 (`textFromView`, composition included), plus `wakeAt` on the first key of a window |
| model | ~60 µs | `EditorCore` (same target, ≤ 60 µs) |
| Loro write | `toJSON` 14 ms + mirror whole-doc diff | one `splice` + commit: O(1) in doc size |
| WAL / send | IDB write + push per commit | none; once per 25 ms window |
| presence | encode + send per selection change | once per 25 ms window, in the tick (P-2) |
| snapshot | 5 s tick, O(doc) | deferred while typing, ≤ 30 s staleness (S-1) |

Gate: the S8 `bench` tier and SCOPE §3.4 rule 9. The M3 exit criterion is keystroke p50/p95
no worse than today at three document sizes, including WKWebView.

## 8. Risks

- **R-1. A crash inside the coalesce window loses up to 25 ms of typing that was never
  appended.** Today the window is the IDB write latency, which is similar.
  `Hidden`/`PageHide`, `Stop` and every terminal transition force the append (W-1), so a
  graceful close, SPA navigation or editor error never loses it. S8's `no_persisted_edit_lost` deliberately counts
  only durable appends.
- **R-2. Two Loro instances during migration.** Until every block uses `DocSession`, pages
  with both an editor and an unmigrated block load both `loro-crdt` (738 KB br) and the Rust
  core. Migrate the markdown editor and collab surfaces first. They share the startup path.
  Once the editor is on the session, `loro-crdt` is loaded lazily and loses its preload (§4.6).
- **R-3. The `EphemeralStore` clock patch** (P-1) is a vendored copy of one Loro file in
  `sync_protocol::presence`, shared by server and client, until an upstream `*_at(now)` PR
  lands. S6 C9a's parity test pins it to loro's bytes.
- **R-4. Mixed bundles in one browser.** They share the BroadcastChannel (same shape) and the
  v1 WAL store (§3.5). Old bundles ignore the new fields, push every undelivered row, and may
  prune new delivered rows, all of which is safe. The new bundle adopts legacy rows and assists
  live old tabs' rows (O-5). Rollback to an old bundle therefore strands nothing. Old bundles
  ignore `quarantined` too and may push a parked poison row; the server refuses it silently, as
  today. A held Web Lock costs Chromium's back/forward cache (O-1).
- **R-6. Power loss.** IndexedDB `durability: 'default'` is not fsynced in Chrome (S9 §3), so
  SC-1 promises survival of renderer and browser process death only. S8 `CrashProfile{mode:
  PowerLoss}` measures what an OS crash loses.
- **R-5. Executor drift.** Two executors exist: the TS one and the sim's Rust one. S8 §9
  records sim effect traces and replays them through the TS executor against a fake socket
  and IDB as a golden test.
- **R-7. Rollout gate.** The `document-session` flag is enabled for no user before S6 PR 5 and
  PR 6 are deployed to production. Superset rows, assist pushes and foreign rows raise the rate
  of imports the server holds pending, which only PR 6 keeps across compaction.

---

## R1 resolutions

Audit R1-C findings that touch this spec. Findings not listed belong to S6, S8 or S9.

| Finding | Resolution |
| --- | --- |
| F2 (High) presence clock | Accepted. P-1 uses `sync_protocol::presence::EphemeralStore` (shared with the server); timestamps are `UnixMillis` wall; `PresencePolicy.timeout` compared against wall; D-4(e); R-3 updated. |
| F3 (Medium) crate paths | Accepted. §0 table uses flat `crates/sync_protocol`, `crates/sync_doc_id`, `crates/sync_sim`, and `crates/client/<crate>` with no `sync/` level; schema path is `crates/sync_protocol/bebop/schema.bop`; `macro_document_model`, `sync_protocol`, `sync_doc_id` added to the wasm-safe allowlist. |
| F7 (High) Loro clock/randomness | Accepted. D-4 rewritten (a)–(e): `record_timestamp` off, `set_peer_id` right after `new`/`fork`, no detached editing, no `timeout_ms`, `merge_interval = 0`, shared presence store. Row 44 is now Δ. `SyncDoc::replace` and §2.5 fork follow D-4b. |
| F8 (High) storage contract | Accepted. §1.6 is the only core-facing contract; adds `StorageFailure::Uncertain`, SC-3 re-emit after `Uncertain`, SC-5 no wipe, SC-6 idempotent append, SC-7 eviction rule, SC-8 own DB identity, write-once schema; S9 executes it. |
| F9 (High) IDB layout and rollback | Accepted. §3.5 and §4.4: same `macro-document-wal` v1 `updates` store, no index, no version bump, extra `owner`/`seq`/`user`/`foreign` fields, per-row `delivered` durable, in-place atomic `WalAdopt`. Two-step legacy copy deleted; R-4 rewritten. |
| F10 (Medium) Tauri storage | Accepted. §3.6 Tauri row: IndexedDB executor in M3; native Turso only via S9 Phase 1 plugin executing `StorageOp`. |
| F11 (Medium) native leases by pid | Accepted. O-1: in-memory registry, `process_epoch` in `meta`, `wal_lease` table deleted. |
| F12 (Medium) frozen/mixed tabs | Accepted. O-5 assisted delivery; `LocalState.assist`; row 121. S8 adds `Freeze`. |
| F13 (Critical) reset loses the batch and reset-time edits | Accepted. I-3 step 0 (forced append; every edit while `Resetting` appends at once) and 3a (`logged_vv` on the new doc, new peer registered first). `ResetPhase::Flushing` and §3.2/§3.4 updated. |
| F14 (Critical) chatter dependency hole | Accepted. W-10 (chatter after `Done(Ok)`; imported chatter stored as foreign rows and delivered by the importer); O-4 "known gap" removed; `chatter` requires `Durable`. The server half (F25) is fixed in S6 PR 6. |
| F15 (High) offline reopen replay | Accepted. W-8 replays every row with `seq > covers_for(owner)`, delivered or not; `WalAdopt` keeps those rows with `delivered`/`created_at`. |
| F16 (High) TTL and seq rebuild | Accepted. W-7 rewritten; `LocalState.own`/`own_delivered_through` removed; `WalDropExpired{from}`; `first_seq` allocated at issue. |
| F17 (High) permission loss mid-session | Accepted. W-6 access change rules, `effective_access`, `SyncEvent::AccessChanged`. |
| F18 (High) comment authorization | Accepted. `AuthorizationState.can_comment`; §2.5 step 0 gate; `Refused(Unauthorized)`; wasm/FFI signatures updated. |
| F19 (High) snapshot replies | Accepted. C-2 FIFO per `ConnId` with the vv check as an assertion; I-1 no longer imports `RemoteSnapshot`; row 17 Δ. |
| F20 (Medium) reset side effects | Accepted. I-3 step 4 (undo rebuilt, old presence key cleared first, container cache re-resolved). |
| F21 (Medium) unmapped S5 behaviours | Accepted, all 11: rows 110–120 plus "On synced" 1a, C-4, the telemetry parent rule, PE-4, §4.3 rule 5, S-2 empty snapshot, close-code rows, Reassembler Δ, I-2 reset-in-Loading, §2.2 NotReady and undo. Item 5: the ai-editing-worker stays on TS in M3 (row 114), which **needs maintainer confirmation**. |
| F22 (Medium) ≡ rows that are Δ | Accepted. Rows 6, 39, 40, 51, 53, 81 now Δ with reasons (also 17, 44). |
| F23 (Medium) `Unlogged` and poison | Accepted. W-2 (rollback of `logged_vv`, pushable run, delivered `Unlogged` never appended) and W-11 poison quarantine (`WalQuarantine` replaces S9's `WalDelete`). |
| F24 (Medium) unbounded push | Accepted. W-3 cap 256 KiB or 64 entries. |
| Compat table | Accepted. Bounded reset keeps the WAL (I-3); new DB name replaced per F9. |
| F35 (part) power loss | Accepted. SC-1 reworded to process death; R-6 added. |
| F37 (Medium) idle definition | Accepted. `is_idle` drops the connection clause for `None`; terminal `Closed` never idle; `busy()` reasons. |
| F39 (Medium) heartbeat | Accepted. Fixed cadence, the `missed + 1 ≤ max_missed` row, any pong resets `missed`, ~35 s death. |
| F40 (Medium) backoff | Accepted. Attempt reset at `Opened` (500 ms loop kept, ≡); `LocalChanged`/`Flush` revive only `GaveUp` (Δ, row 81). |
| F41 (Medium) flush and pre-`Running` | Accepted. `Timeouts.storage = 10_000`; W-8 late rows as a normal remote diff; `NotReady`. |
| F42 (Medium) wall time on web | Accepted. §4.1: `wall` on every cold call and `host`, re-basing `wall_origin`; executor constructed first and creates the session with its own `now()`. |
| F43 (Medium) Web Locks, shared profiles | Accepted. SC-9 and §4.3 rule 4 (queue behind the lock); `UserKey` on config and rows; O-2 same-user adoption only. |
| F44 (Low) peer order, FetchToken, ResetBudget | Accepted. `registered_peers: IndexSet`, current peer first; `FetchToken{attempt, doc}`; `ResetBudget` counts started resets. |

## R1 consistency pass

Checked every `lexical_model` reference against S1 Revision R1 (the source of truth):

- §2.2 Local edits: `core.apply(input, now)` returns `Output { commits, diff, effects, handled }`
  (not `{commit, ..}`); every commit in `commits` is projected, and on
  `Err(ApplyError { committed, .. })` the already-applied `committed` commits are projected too
  (S1 §15, §15.2, F-24).
- §2.2 Remote: `Input::ApplyRemote { changes, options }` with the remote-update tags.
- §2.2 Build (new bullet): the session editor comes from S3's preset/headless builder with an
  explicit `EditorMode` and `.opaque_unknown_types(true)`, per the D-23 ruling (on for
  collaborative document sessions, including the headless ai-editing-worker session; off for
  routes and the gate). `CoreConfig.history` is `None`.
- §2.2 Undo: `Input::Undo`/`Redo` stop at the surface; lexical's merge heuristics are
  `lexical_model::History::record` → `HistoryAction` driving `group_start`/`group_end`.
- §2.2 needs: the postcard encoding of `Input` is not in S1 R1 and stays open on S1. (Superseded in R2: no wire encoding of `Input` is needed, §4.2.)
- §2.5 comment fork: the temporary `EditorCore` is built Headless with the option on and no
  history.
- §3.1 / §3.2 flows: `Commit { changes.dirty_leaves }`, `Diff { view_text_matches, ops }`
  (S1 §11.2, §15.3) and `DiffOp::{Text, CreateText}` instead of the informal shapes.
- I-3 step 4: `Effect::HistoryState(HistoryAvailability { .. })` is emitted by the surface.

## R2 resolutions

Revision: R2. Audit R2-3 (all 36 findings; this spec owns most of them) and the sync items of
audit R2-4. S11 (`S11-loro-projection.md`, written in parallel) owns `lexical_loro`'s live
projection; this spec only calls it.

| Finding | Resolution |
| --- | --- |
| R2-3 F1 (Critical) missing ack treated as poison | Accepted, redesigned. W-11: no-ack is never evidence; 20 not-acked pushes only enter `Delivery::Suspect` (backoff 5 s → 5 min, `Unsaved(Undelivered)`, `wal.delivery_outage{suspect}`); poison needs a local proof (`SyncDoc::probe_import` of the head row onto a fresh server snapshot fails with a non-pending, non-`Outdated` Loro error); a proven row is **parked** (`WalQuarantine` sets `quarantined`, never deletes) and a reset gives a fresh peer so later edits never depend on it. W-6 adds `conn_access` from `TokenEvent::Fetched.access`; regaining write on a View-token connection closes it (`Superseded`) and reconnects. §1.5 "`Saved` is earned": never `Saved` while any row is undelivered, parked or rebasing. §1.6/§4.4 schema gains `quarantined`. |
| F2 (High) terminal paths drop the window | Accepted. W-1 terminal rule: every entry into `Stopped`/`Closed(_)` appends first; `Stop(RequestId)` → `Reply::Stopped` after `Done`; lock released after the queue drains; `AccessChanged(Read)` after `Closed(Corrupt\|Unauthorized)`; IDB `tx.commit()` on `Hidden`/`PageHide`/`Stop`. Transition table, row 99, R-1. |
| F3 (High) shallow-root `Outdated` reset storms | Accepted. `ImportFailure::Outdated`; I-2' unbudgeted, coalesced, ≤ 1 per 10 s rebase; W-8 `needs_rebase` (push, then rebase once); S-2' local seed wins when orphans need replay; S-1' snapshot root at `confirmed_base` (`export_shallow_snapshot(at)`); `ResetBudget` counts only `Loro`/`Projection`/poison. Rows 16, 123. |
| F4 (High) foreign-row echo | Accepted. W-10.1/.2/.4/.5: chatter only after own appends; foreign rows stored only by `Edit` sessions and only when `Imported.new_ops`; never re-posted; delivered by server evidence, bytes omitted from pushes unless the writer is gone or `retry_unacked_after` passed. |
| F5 (High) parked rows vs `is_idle` | Accepted. `is_idle` ignores parked entries; `busy()` gains `Rebasing`; `parked()` reports `ReadOnly\|Poison\|Gap\|NeedsRebase`; `Flush` reports parked rows as `NotDrained` at once (§2.4). |
| F6 (Medium) orphans behind live locks | Accepted. O-1 lock released on drop after the drain, `Closing` posted from the release callback; O-4 `LoadOrphans` also on `Visible` and on S-1 ticks (≤ 1 per 30 s) while assist/live foreign owners exist. |
| F7 (Medium) W-2 gap rows | Accepted. W-2 superset row from `vv_before(n)`, no new window while a later entry is `Writing`, `superseded` entries; load-time `Gap` parking with `wal.gap`. |
| F8 (Medium) snapshot holding unlogged ops | Accepted. S-1 step 2. |
| F9 (Medium) comment after typing | Accepted. §2.5 step 2 runs W-1 first and checks `oplog_vv ≠ logged_vv`. |
| F10 (Medium) FIFO correlation | Accepted. C-2: FIFO per `(ConnId, kind)`, tombstones, vv-matched skip, shared snapshot answers, routed `ConnId` per subscribe/close. |
| F11 (Medium) presence wire shape | Accepted. P-1 table and cross-language fixture. |
| F12 (Medium) decode errors | Accepted. §1.4 note, `CloseCause::ProtocolError`, transition row; never a reset. |
| F13 (Medium) rollout gate | Accepted. R-7. |
| F14 (Medium) presence crossings, IME | Accepted. P-2 coalesces presence into the window tick; `textFromView(key, text, anchorOffset, focusOffset, selKind, flags, compositionData?, now)`, `compositionStart/End` exports; §3.1, §4.1, §7 now say one call plus `wakeAt` on a window's first key. |
| F15 (Medium) IDB O(WAL) scans | Accepted. §4.4 per-session `seq → primary key` map; `WalAppend.retry` gates the only scan. |
| F16 (Low) snapshot tick while typing | Accepted. S-1 step 3 deferral (1 s idle, 30 s max), `doc.snapshot.save`. |
| F17 (Medium) FFI Turso on the caller's thread | Accepted. §5 and §3.6: store on the wrapper's serial background queue; `handle` never performs I/O. S9 §6 notes it. |
| F18 (Medium) boundary encoding | Accepted as written in the audit. §4.2: primitives for hot calls, S1 flat `u32` diff, bebop `session.bop` for the rest (generated, checked in, staleness CI), magic + generated `ABI_MAJOR`/minor header, `AbiMismatch`, byte-equal fixture round trip; `Input` gets no wire encoding (`EditorInputMsg` adapter), so the S1 open item is withdrawn; uniffi records only on FFI. |
| F19–F24 | S8 (see S8 R2 resolutions). F21's `peer.assigned` record is §2.5 step 5 here. |
| F25 `StorageOpId` | `u32`. |
| F26 `reset_requested` | `Phase::Loading { .., reset_requested }`. |
| F27 `WalAdopt` count | `StorageEvent::Adopted{n}`, `storageAdopted`; entries added on completion; `AssistInFlight` slot. |
| F28 W-8 source | Stated in W-8. |
| F29 downgrade target | `CommentOnly` when `can_comment` (§1.4 doc, W-6). |
| F30 presence timeout type | `WallDuration` from `sync_protocol::time` (S6 adds it). |
| F31 router frames | `Route::Subscribing.pending` doc. |
| F32 unspecified client cases | `RemoteInitialSync` while `Synced` = reconnect, never imported; unknown discriminator dropped (§1.4). |
| F33 chatter user | §1.4 `ChatterMessage` doc: ignore `Update` while the profile's user differs. |
| F34 bfcache | O-1 and R-4. |
| F35 other users' rows | W-7 step 4, `WalDropExpired` doc. |
| F36 `History` retention | §2.2 uses S1 `MergeTracker::classify`; requested from S1. |
| R2-4 H7 milestones | Accepted. Top-of-spec milestone table: M1 headless, M2 projection + `doc_sync_core` + `document_session` (+ `sync_sim`), M3 web editor and session swap together behind `document-session`, M4 ai-editing-worker, M5 native. Row 114 (worker on TS until M4) stands. SCOPE §5 is read-only here; WORKPLAN should follow this table. |
| R2-4 H4 loro skew | Accepted. Pin both sides to 1.16.2 in WP-00 (crates.io has no 1.16.3), or bump both to 1.17.1 if 1.16.3 holds a core fix; one PR, three lockfiles, mixed-version check (§0). |
| R2-4 H3 web build/load | Accepted. §4.6: just recipes via `cached-wasm-build.sh`, `build-wasm` list, `cargo x deps`; `nix/tauri-desktop.nix` `coreWasmPackages` and `build-tauri-dev`; Loro's preload slot handed over at GA, `loro-crdt` lazy; main-thread init, no iOS worker; 10 MB per-file limit with a 6 MB budget / 8 MB gate; workerd target for M4; CI path filter (also R2-4 M7). |
| R2-4 M6 observability | Accepted. §4.7 span table, hop propagation, M4 taxonomy, Tempo acceptance check. |
| R2-4 B3 composers in wasm | Accepted for this spec: `macro_document_model` with `default-features = false`, plus the `cargo tree … -i workspace-hack` WP-00 check (§0). Moving the composers is S3's call. |
| R2-4 M3 hakari | `sync_doc_id` explicit exclude; `crates/client/*` glob noted (§0). |
| R2-4 M4 clippy.toml | D-3 is an ast-grep rule, not a crate `clippy.toml`. |
| R2-4 H8 `Input` encoding, `record_timestamp` | `Input` needs no encoding (F18); D-4 scope stated (server snapshots keep `true`). |
| R2-4 B1 projection spec | Delegated to S11; §2.2 "Needs from siblings" points there. |
| R2-4 L4 executor owner | `packages/collaboration` owns the executor, its vitest project and `abi.generated.ts` (§4.3). |
| R2-4 H2 comment gate | No change here; S6 keeps the gate as an HTTP port this pass (S6 R2). |

## R2.1 consistency

Part B of the final pass: S1 R2.1's list for S7, S12 §0.2's S7 rows, S13's coordination item.

| Item | Change |
| --- | --- |
| S1: `session.bop` ownership | §4.2: `ABI_MAJOR`, mirrored `DIFF_FORMAT_VERSION`/`DiffOpcode` with the compile-time assertion and opcode test; `EditorInputMsg` (already R2); hot `Input` from primitives with `text_from_utf16`; the `Input`/`Output` round-trip test is a bebop test here (was S4's postcard `api_shape` test) |
| S1: `MergeTracker` | §2.2: one stateful `MergeTracker::new(delay_ms, now)` + `classify(commit, now)`, without `History` ("stateless" corrected) |
| S1: commits and effects | §2.2 "Outputs": whole `Output::commits` (follow-ups included) projected; `Effect::PluginEvent` routed; `Effect::FollowUpFailed` reported as telemetry |
| S1: `view_host` | §2.2 Build, §5: `EditorBuilder::view_host` (no `CoreConfig.platform`); `ViewEngine::Native` for the FFI sessions |
| S1: `take_initial_output` | §2.2 "Initial output": drained once after build, projected before the first input (S11 §5.1) |
| S1: `SetViewSelection` | §2.2, §4.2: `{ selection, format, style }` crosses; the elision is EditorCore's, no session rule |
| S1 / S12 §0.2: `EditorSession` | §4.1: `composition`, `keyDown`, `query` (`nodesOfType` = `nodes_of_type_index` + `export_json`), `clipboard`, `typeTable` (`Registry::type_table()`), `listenerTable` (`Editor::listener_table()`), dev `debugViewChecksum`, `debugShouldPreventDefault` (`Read::should_prevent_default_and_insert_text`); cold inputs carry `ClipboardPayload::html_nodes`, `ViewSelection::Table`, `SelectionChangeContext::triple_click` |
| S12 §0.2: `FfiInput` | §5: `Composition`, `KeyDown`, `Paste`, `Undo`, `Redo`, `ModifyTarget` payloads; `FfiViewEffect::{Decorators, HistoryState}`; `query` |
| S1: "Needs from siblings" | §2.2: the post-commit item is done (`Plugin::after_commit`, S1 §14.2) |
| S13 §3.2 | §0: `sync_doc_id` depends on `document_id` (`From<DocumentId> for SyncDocId`), never the reverse; `document_id` joins the wasm-safe allowlist |
