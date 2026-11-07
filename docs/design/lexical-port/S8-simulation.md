# S8 — `sync_sim`: deterministic simulation of the whole sync stack

Revision: R2 (audit R1-C, R1-D §E, then audit R2-3 Part F and the S8 items of F1–F5 applied;
see "R1 resolutions" and "R2 resolutions" at the end), plus the R2.1 consistency edits.

Status: spec, nothing built. Depends on S7 (`doc_sync_core`, `document_session`) and on S6
(`sync_server_core`, `sync_server_sim`). This crate exists because every component in S7 is
sans-IO and S6 gives the server a synchronous sans-IO step. One thread, one virtual clock and
one seeded RNG drive N clients, a server, a network and browser storage. Any failure replays
from `(seed, script)` byte for byte.

Crate: `crates/sync_sim` (dev-only; flat path per S6 §2.1, `crates/testing/sync_sim` after reorg
phase 3). It depends on `sync_server_core` and `sync_server_sim` because it is not under
`client/**`. It is never linked into a shipped artifact.

Test style follows the repo rules:

- Story tests are one full explicit literal script each, tagged with the S7 §6 rows they cover
  (`/// covers: S7:13`, S4 §0.1).
- The proptest generator is the only generated input.
- There are no sleeps or polling (CS-66). Time is virtual.

---

## 1. The world

```rust
pub struct Sim {
    clock: SimClock,
    rng: rand_chacha::ChaCha8Rng,          // the only randomness; seeded from SimConfig.seed
    net: SimNetwork,
    server: SimServer,
    profiles: BTreeMap<ProfileName, SimStorage>,   // one per browser profile / device
    clients: BTreeMap<ClientName, SimClient>,
    log: EventLog,
    stats: RunStats,
    config: SimConfig,
}

pub struct SimConfig {
    pub seed: u64,
    pub document: SeedDocument,            // document 0
    /// Further documents (DocIx 1..). Needed for routed transport, where one router socket
    /// carries several routes. Empty by default.
    pub extra_documents: Vec<SeedDocument>,
    pub net: NetProfile,
    pub storage: StorageProfile,
    pub server: ServerBuild,               // Current | Pinned(ReleaseTag)
    pub session: SessionDefaults,          // S7 SyncConfig defaults: timeouts, heartbeat, backoff, coalesce
    pub budgets: Budgets,                  // settle: 180_000 ms virtual; quiet: 60_000; max_events: 2_000_000
    pub per_step: PerStepChecks,           // All | None (None only for perf runs)
    pub ties: TieMode,                     // Fifo | Perturb
    /// Server quirks a failure may be explained by (§4.2). Shrinks as S6 fix PRs land.
    pub quirks: &'static [KnownServerQuirk],
}

pub enum SeedDocument {
    Markdown(&'static str),
    Empty,
    /// A named document from the gen-docs corpus, e.g. `"large"` (the 500 KB document).
    Corpus(&'static str),
    /// A cached open: the server holds `server`; the opening host also has an S3 cached snapshot
    /// (`Seed{CachedS3}`) and/or a profile-local snapshot, each an older markdown version, all
    /// racing the remote initial sync (S7 S-2).
    Cached { server: &'static str, s3: Option<&'static str>, local: Option<&'static str> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)] pub struct ClientName(pub &'static str);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)] pub struct ProfileName(pub &'static str);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)] pub struct UserName(pub &'static str);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)] pub struct DocIx(pub u8);

impl Sim {
    pub fn new(config: SimConfig) -> Sim;
    /// Runs the script, then the finals pass. Never panics on a sync failure: failures are
    /// returned in `Outcome` so shrinking and the story printer see them.
    pub fn run(self, script: &[Step]) -> Outcome;
}
```

`SimConfig::calm(seed)` fills every field with the calm defaults (one Markdown `"Hello"` doc, no
extra documents, `NetProfile::calm()`, `StorageProfile::fast()`, `ServerBuild::Current`,
`SessionDefaults::production()`, `Budgets::default()`, `PerStepChecks::All`, `TieMode::Fifo`,
`KNOWN_SERVER_QUIRKS`). Stories override fields with struct-update syntax.

### 1.1 `SimClock`

```rust
pub struct SimClock { now: Millis, wall_origin: UnixMillis, queue: BinaryHeap<Reverse<Scheduled>>, next_seq: u64 }
struct Scheduled { at: Millis, seq: u64, event: Pending }   // ordered by (at, seq)
enum Pending {
    ClientWake(ClientName, Generation),        // the client's single timer (S7 wake_at)
    Deliver(Delivery),                         // a network frame, a connect result, a close
    StorageComplete(ProfileName, PendingWrite),
    TokenReady(ClientName, u32),
    ServerAlarm,
    ServerStorageComplete(ServerWrite),        // a server write became durable; may release gated sends
    ServerInputReady(ServerInput),             // an input queued behind the room's busy window (§1.4)
    ChatterDeliver(ProfileName, ClientName, ChatterMessage),
}
```

- Ties are broken by insertion `seq`. That is deterministic.
- `TieMode::Perturb` breaks ties with the RNG instead, so the generator also explores
  same-millisecond orderings. Any equal-time interleaving is reachable from some seed, and
  each seed is still deterministic.
- `wall = wall_origin + now + skew(client)`. `wall_origin` is fixed at `2026-01-01T00:00:00Z`
  unless a story sets it. TTL stories jump the wall clock with `Step::AdvanceWall`;
  `Step::ClockSkew` sets a per-client offset. The server's `Clock::unix_time` has no skew.
- Each client has exactly one wake: rescheduling bumps its `Generation`, and stale wakes are
  dropped. This mirrors the executor's single `setTimeout`.

### 1.2 `SimNetwork`

The model is **WebSocket semantics**. A connection is ordered and reliable until it breaks.
Real faults are breaks, black holes and latency. S7 relies on per-socket FIFO (C-2 reply
correlation, the frame reassembler), so `Hostile` never breaks order *within* a connection:
it reorders and duplicates **whole messages across different connections** and duplicates
idempotent messages (updates, acks, presence) on one connection. It needs S7's decode-error
rule (a garbage reassembly closes with `ProtocolError`, never resets). Under `Hostile` only the
safety invariants are asserted (no loss, no divergence, refused never applied:
`no_acked_edit_lost`, `no_persisted_edit_lost`, `all_docs_equal`, `editor_states_equal`,
`refused_updates_never_applied`, `per_step`); `settled` and `quiet` are dropped.

```rust
pub struct SimNetwork { conns: BTreeMap<SimConnId, Link>, partitions: BTreeSet<ClientName>,
                        offline: BTreeSet<ClientName>, profile: NetProfile, bus: BTreeMap<ProfileName, ChatterBus> }

struct Link { client: ClientName, client_conn: ConnId, state: LinkState, up: VecDeque<InFlight>, down: VecDeque<InFlight> }
enum LinkState { Connecting { ready_at: Millis }, Open, Closing, Closed }

pub struct NetProfile {
    pub latency: (Millis, Millis),     // uniform per frame, e.g. (5, 80)
    pub connect_latency: (Millis, Millis),
    /// Probability that a given frame kills the connection (both directions lose everything
    /// in flight), per frame.
    pub break_per_frame: f64,
    pub hostile: Option<Hostile>,
}
/// `reorder`: across connections only. `duplicate`: whole idempotent messages. `drop_frame`:
/// drops one frame of a multi-frame message, which the client must answer with a
/// `ProtocolError` close (S7 §1.4).
pub struct Hostile { pub reorder: f64, pub duplicate: f64, pub drop_frame: f64 }
```

| Fault | Effect | How it reaches the client |
| --- | --- | --- |
| delay | per-frame latency; FIFO per link direction (a frame is never delivered before an earlier one) | — |
| break | link closes; in-flight frames in both directions are lost | `Socket{Closed{1006, clean:false}}` at `now + latency` |
| partition (client) | every frame to or from the client is black-holed; links stay "open" | heartbeat timeout → client closes; connects during a partition black-hole indefinitely (no open, no close), as real partitions do, so S7's `timeouts.connect` (15 s) abandons them |
| offline (client, sim-only `Step::Offline`) | `navigator.onLine = false`: token fetches fail and connects fail fast, at `connect_latency.1 * 4` (only this fault has the fast failure) | `Token::Failed`, `Closed{1006}`; `Step::Online` sends `HostSignal::Online` |
| drop next n (direction) | the next n frames silently vanish, with no close | e.g. a lost ack |
| lose acks n | drops the next n `RemoteUpdateAck` after the server made the update durable | the ack timeout; the WAL resends |
| corrupt next (direction) | the next binary frame's Bebop payload is replaced by a structurally valid message whose Loro `update` bytes fail to import | client import failure → reset (S7 I-2); server import error → `ws.message.error`, no ack |
| server close | server-initiated close (eviction with sockets, auth revoke, surface revoke, freeze) | `Closed{1000 \| 1008 \| 4000 \| 4401}` |
| hostile reorder / duplicate / drop_frame | reorders whole messages across connections, duplicates idempotent messages, drops one frame of a multi-frame message | idempotency under abuse; safety invariants only (above) |

- The `ChatterBus` per profile is BroadcastChannel. It is reliable and ordered, and it
  delivers to every other live, unfrozen client in the profile after 0–2 ms. A frozen client's
  messages queue until it thaws.
- **Routed transport.** With `SessionDefaults.transport = Routed`, every client of a profile
  shares one router link, so a break drops every document route at once. The DSS side is
  `SimRouter`, a protocol fake (`RouterSubscribe` → `RouterSubscribed` /
  `RouterSubscribeFailed` / `RouterDocClosed`, an owner joining an open route forcing a
  resubscribe). `crates/sync_router`'s domain router uses tokio, so it can't run on the sim
  thread; `SimRouter`'s behaviour is pinned by replaying `sync_router`'s own router tests'
  inputs through it. Routed runs need at least two documents (`extra_documents`).

### 1.3 `SimStorage`

There is one per profile. Storage outlives tabs, and a crash keeps what was durable.

```rust
pub struct SimStorage {
    durable: StoreImage,                    // what a fresh tab would read
    pending: BTreeMap<u64, PendingWrite>,   // issued, completion not yet delivered
    recent: VecDeque<(Millis, DurableWrite)>, // completed writes inside the power-loss window
    leases: BTreeSet<(SyncDocId, SessionId)>,   // Web Locks held by live (or frozen) sessions
    user: UserName,                         // the profile's signed-in user (Step::SignIn)
    faults: StorageFaults,                  // fail_writes, quota_after_bytes, latency, fail_load, uncertain_next
}
pub struct StoreImage {
    /// v1 `updates` rows. `owner == None` is `Legacy`. Per-row `delivered` is the durable form (S7 §1.6).
    pub entries: BTreeMap<(SyncDocId, WalOwner, WalSeq), (WalRecord, bool /* delivered */)>,
    pub snapshots: BTreeMap<SyncDocId, (Vec<u8>, Option<(SessionId, WalSeq)>)>,
}
```

It executes S7 `StorageOp`s with the executor contract:

1. A write becomes durable and its completion is scheduled at the same instant,
   `issue + latency`. SC-1: completion ⇒ durable (against process death).
2. Writes per doc apply in issue order (SC-2).
3. `WalAdopt` is atomic and conditional on `owner == from` (SC-4); `WalAppend` is idempotent on
   `(doc, owner, seq)` (SC-6).
4. `Load` returns orphans by consulting `leases` (S7 O-2), live foreign rows as `assist`
   (O-5), and only rows whose `user` is the profile's current user.
5. No op waits for a lease grant in the sim (grants are instant), but the queue is per session
   so SC-9 ordering is still exercised.

Crashes:

- `Crash{client}` (tab dies):
  - the client's in-memory session is dropped;
  - its lease is released;
  - its pending writes **still complete**, because the browser process lives on. That is the
    IndexedDB reality for an in-flight transaction of a killed tab.
- `CrashProfile{profile, mode: ProcessDeath}` (browser or device process dies): every pending
  write is **lost**, every client in the profile is dropped, and every lease is released.
- `CrashProfile{profile, mode: PowerLoss{window}}`: as above, and completed writes from the
  last `window` ms are also lost (IndexedDB `durability: 'default'` is not fsynced, S9 §3).
  Invariants that rely on SC-1 exclude these writes (`no_persisted_edit_lost` keys on
  `WalWriteLost`).
- `Freeze{client}`: the client processes no input (no wakes, frames, storage completions or
  chatter); its lease stays held. Inputs queue until `Thaw{client}`. This is Page Lifecycle
  "frozen" and mobile Safari backgrounding (S7 O-5).

`StoreImage` is also compared against an `IndexedDbModel` reference in a unit suite. That
suite holds the S7 SC-1..9 conformance tests, which the real IndexedDB adapter (vitest +
fake-indexeddb, and Playwright on real browsers, §9.2) and `doc_store_turso` both run.

### 1.4 `SimServer`

`SimServer` wraps `sync_server_sim::SimRoom` (S6 §2.6), i.e. the real `sync_server_core::Room`
over `sync_server_sim::SimPorts`, and uses its sans-IO view
`step(now, ServerInput) -> StepResult`. There is one set of server fakes, `SimPorts`; this
crate adds only the driver around it.

- **Synchronous ports.** Every `SimPorts` method completes synchronously; `step` drives the
  callback with `now_or_never`. `StepResult::Crashed` (a scheduled `Crash` fault fired) drops the
  room, its non-durable writes and its gated sends, and the next input rebuilds it with
  `NewObject`. A stalled callback without a crash is a harness bug, reported as
  `Failure{invariant: "server_stalled"}`.
- **Output gate** (`GateMode::Held`). Every send is tagged with the storage writes issued
  before it. Each write becomes durable at `issue + storage latency` (`ServerStorageComplete`);
  a send is released to the network only when every earlier write is durable. `AckSent` is
  recorded at release.
- **Busy window.** D1 (`PeerDirectory`) and `CommentGate` calls carry a drawn latency; `step`
  returns the accrued `busy_for`, and inputs for the room that arrive before `busy_until` are
  queued (`ServerInputReady`) and delivered in arrival order afterwards. That is the mutation
  barrier. The core's `Clock` advances by the accrued latency inside the callback (S6 §2.6).
- **Front door.** Ahead of `Room::connect` the sim models the worker's HTTP upgrade and JWT
  check. A `SimTokenMinter` issues tokens per client from its current grant (`Access` →
  `AccessLevel`, comment-only → `CommentMarks`), with an expiry. An expired or revoked token gets
  HTTP 401 on upgrade, which a browser sees as `Closed{1006}`. Grants are not a server port:
  the server sees only the verified `AuthToken` at connect (S6 §2.3).
- **Comment gate.** `InProcessCommentGate` implements S6's `CommentGate` over
  `macro_document_model`'s comment-only check. Production keeps the lexical-service HTTP
  adapter, so sim results speak for production only while the **gate parity test** (§13)
  passes. Gate faults: `Server(Gate(Error))` and `Server(Gate(Timeout))` make the next verdicts
  fail, which the core treats as refuse (fail closed, S6 M10).
- **Server faults** (`ServerStep`):

  ```rust
  pub enum ServerStep {
      /// DO eviction: in-memory room dropped, durable storage kept, reloaded on the next input.
      Evict { close_sockets: bool },
      /// Every socket closed (a deploy).
      Restart,
      /// Crash in the middle of the next callback, after `after_port_calls` port calls, via S6
      /// `FaultSchedule`. Gated sends and non-durable writes are dropped. Distinct from `Evict`,
      /// which only drops memory.
      Crash { after_port_calls: u16 },
      /// Hibernation between two frames of a multi-frame client message (S6 H10).
      Hibernate,
      /// Pushes durable completion (and so gated acks) past the 5 s client timeout.
      DelayStorage(Millis),
      Gate(GateFault),                 // Error | Timeout
      /// D1 (`PeerDirectory`) returns errors for `ms`: the M9f mapping fails before the ack, so
      /// updates are applied and stored but never acked (S7 W-11 must not quarantine).
      D1Outage { ms: Millis },
      /// The next `n` `RoomStorage` puts fail (`FaultSchedule` errors): no ack for those updates.
      StorageErrors { n: u8 },
      /// Revoke the collab surface (1008 closes, S6 S4).
      SurfaceRevoke,
      /// Freeze the migration source (1008 on every message, S6 M1).
      FreezeSource,
      /// An agent edit through the atomic HTTP API (S6 R9): a fork of the server's current state
      /// with an AI-range peer applies `text` at `at` and calls `Room::update_document`.
      HttpUpdate { at: Pos, text: SimText },
      /// `Room::exists`, the path DSS takes on every HTTP read (S6 H9).
      ExistsProbe,
      /// Replace the stored snapshot with bytes that fail to import (S6 A3, H8).
      CorruptSnapshot,
      Heal,
  }
  ```

- **Known server quirks.** S6 preserves today's quirks during extraction. A failure fully
  explained by an allowlisted quirk is reported as `quirk_hit` and counted in `RunStats`, not
  as a failure:

  ```rust
  pub struct KnownServerQuirk {
      pub id: &'static str,                       // "H9" | "A4" | "E7" | "A3" | …  (S6 §5.2)
      pub invariants: &'static [&'static str],    // which invariant failures it may explain
      pub matcher: fn(&Outcome, &Failure) -> bool,
  }
  pub const KNOWN_SERVER_QUIRKS: &[KnownServerQuirk] = &[ /* H9, A4, E7, A3 */ ];
  ```

  H9 and A4 leave the list when S6 fix PRs 5 and 6 land.
- **Invariant hooks.** The room's port log, tagged by callback index, goes into
  `Outcome.server_ports` (§3). `ServerDurable{update}` is recorded when the `o/` put for that
  update becomes durable; `AckSent` at gate release.

### 1.5 `SimClient`

A `DocumentSession` (S7) and a Rust executor. The executor does exactly what the TS executor
does, aimed at the sim:

- `SocketConnect` → front door → `SimNetwork` link;
- `SocketSend` → `up` queue;
- `Storage` → `SimStorage`;
- `ChatterPost` → bus;
- `FetchToken` → `TokenReady` after 20–200 ms from the token minter, or `Failed` when the
  client is offline or a `TokenFetchFail` is armed;
- `wake_at` → `ClientWake`.

```rust
pub enum ClientBuild { Current, Pinned(ReleaseTag), TypeScript, Faulty }
pub enum SurfaceKind { Editor, Form }       // Form exercises GenericSurface
pub enum ClientKind { Tab, AiWorker }
```

- `ClientBuild::Faulty` is `Current` with a projection bug injected: its local commits produce
  structurally valid Loro ops that the editor projection rejects (for example a text container
  under a node type that has none). Peers importing them hit S7 I-2's projection-failure reset.
- `ClientKind::AiWorker` models the ai-editing-worker: `PeerRange::Ai` peers (S7 PE-4),
  `Persistence::Memory`, `TransportKind::Direct`, no chatter, `PresenceKeyMode::Fixed` with
  `encode_all` keepalive every 2 s and a 700 ms linger, and a `Flush` before `Close` whose
  `NotDrained` reply is the loud failure (`run-edit.ts:225-236`). The server's
  `active_peers(include_ai: false)` must exclude its peers (checked in finals). Today's real
  worker runs as `ClientBuild::TypeScript` + `ClientKind::AiWorker` (§7.2).

Peer ids and session ids come from the sim RNG (S7 D-2). Every `handle` call gets `Now` from
`SimClock`, with the client's skew applied.

---

## 2. Scripts

### 2.1 `Step`

```rust
pub struct OpenSpec {
    pub client: ClientName, pub profile: ProfileName, pub doc: DocIx,
    pub access: Access, pub build: ClientBuild, pub surface: SurfaceKind, pub kind: ClientKind,
}
impl OpenSpec {
    /// doc 0, `Edit`, `Current`, `Editor`, `Tab`.
    pub fn editor(client: &'static str, profile: &'static str) -> OpenSpec;
}

pub enum Step {
    Open(OpenSpec),
    Edit { client: ClientName, op: AbstractOp },
    /// Advance virtual time, processing everything due.
    Run(Millis),
    /// Heal every fault, then run until quiescent (§2.3).
    Settle,
    Net(NetStep),
    Crash { client: ClientName },
    CrashProfile { profile: ProfileName, mode: CrashMode },   // ProcessDeath | PowerLoss { window: Millis }
    /// Graceful close: `Stop(id)`; the sim drops the session only after `Reply::Stopped` (the
    /// W-1 terminal append is done), releases the lease after pending writes, then posts
    /// `Closing` (S7 O-1).
    Close { client: ClientName },
    /// A new session for a crashed or closed client name: same profile, new SessionId and peer.
    Reopen { client: ClientName },
    /// Reopen every crashed client. The generator always appends this before the final `Settle`.
    ReopenCrashed,
    /// An S7 `HostSignal`: Online, Visible, Hidden, PageHide.
    Host { client: ClientName, signal: HostSignal },
    /// Sim-only: `navigator.onLine` flips. Never passed to the core; `offline: false` also sends
    /// `HostSignal::Online`.
    Offline { client: ClientName, offline: bool },
    Freeze { client: ClientName }, Thaw { client: ClientName },
    Flush { client: ClientName },                       // S7 `Flush(RequestId)`
    /// The host reports an editor error; the session stops (S7 row 99).
    EditorError { client: ClientName },
    Storage { profile: ProfileName, fault: StorageFault },
    Server(ServerStep),
    /// Change what the token minter issues for this client and send it
    /// `Authorization{current, can_write, can_comment}`. The existing connection keeps its
    /// server-side access until the next connect, as the real server does. `force_reconnect`
    /// also closes it with 1008.
    Grant { client: ClientName, access: Access, force_reconnect: bool },
    TokenExpire { client: ClientName },                 // the next connect gets HTTP 401
    TokenFetchFail { client: ClientName, n: u8 },       // the next n token fetches fail
    /// Per-client wall-clock offset (presence LWW and expiry, TTL, commit timestamps).
    ClockSkew { client: ClientName, wall_offset_ms: i64 },
    /// The profile's signed-in user changes; later opens in it run as `user` (S7 O-2).
    SignIn { profile: ProfileName, user: UserName },
    AdvanceWall(Millis),                                // wall clock jump (TTL)
}

pub enum NetStep {
    Partition(ClientName), Heal(ClientName),
    Break(ClientName),
    /// Drop the next `frames` frames on that direction, counting only frames of `kind`
    /// (`None` = any frame, including pings and presence).
    DropNext { client: ClientName, direction: Direction, kind: Option<FrameKind>, frames: u8 },
    LoseAcks { client: ClientName, count: u8 },
    CorruptNext { client: ClientName, direction: Direction },
    Profile(NetProfile),
}

pub enum StorageFault {
    FailWrites, Heal, Latency(Millis, Millis), Quota { after_bytes: u64 },
    FailLoad,                 // the next `Load` returns `Unavailable`
    CorruptSnapshot,          // the stored snapshot's bytes fail to import (S7 S-2, row 39)
    CorruptRow,               // one stored WAL row's bytes fail to import (S7 W-8, row 40)
    Uncertain { next: u8 },   // the next n appends commit but report `Uncertain` (S7 SC-3)
}
```

### 2.2 `AbstractOp`: positions resolved at run time

Every position is an index taken **modulo** what the client's editor holds at the moment the
op runs. Every op is therefore valid in every state, and any subsequence of a script is a
valid script. That is what lets proptest delete steps and shrink numbers freely.

```rust
#[derive(Clone, Copy, Debug)] pub struct Ix(pub u16);                 // resolved as ix % count
#[derive(Clone, Copy, Debug)] pub struct Pos { pub block: Ix, pub offset: Ix }

pub enum AbstractOp {
    Type { at: Pos, text: SimText },
    Backspace { at: Pos, count: u8 },
    DeleteRange { from: Pos, to: Pos },
    SplitBlock { at: Pos },
    Format { from: Pos, to: Pos, format: TextFormatType }, // Bold, Italic, Code, Strikethrough (S1 §2.3; `TextFormat` is the bit set)
    SetBlock { block: Ix, kind: BlockKind },              // Paragraph, Heading(1..=3), Quote, Code
    ToggleList { block: Ix, kind: ListKind },
    Indent { block: Ix }, Outdent { block: Ix },
    InsertTable { at: Pos, rows: u8, cols: u8 },
    PasteMarkdown { at: Pos, snippet: Ix },               // index into a fixed snippet corpus; one snippet is > 1 MB
    MarkdownShortcut { block: Ix, shortcut: Ix },         // SHORTCUTS = ["# ", "- ", "> ", "```"], typed at block start
    AddComment { from: Pos, to: Pos },                    // S7 §2.5 path, for any access
    RemoveComment { mark: Ix },
    Select { from: Pos, to: Pos },                        // drives presence
    Undo, Redo,
    FormSet { field: Ix, value: u16 },                    // GenericSurface ops
    FormMove { from: Ix, to: Ix },
}

pub enum SimText { Ascii(u8), Literal(&'static str), Astral, Combining, Mixed(u8) }  // u8 = length
```

`Type` inserts literal text; it never applies markdown shortcuts. `MarkdownShortcut` does.

Resolution is the `resolve(&EditorState, Pos) -> Option<Point>` function:

1. Take the text-bearing blocks in document order. `block = blocks[ix % n]`.
2. `offset = ix % (utf16_len + 1)`, moved back off a surrogate-pair middle.
3. `n = 0`, a read-only client for a mutating op, or a session before `Seeded` gives `None`.
   The op is logged as `OpSkipped` and does nothing. Shrinking never makes a script invalid,
   only shorter.

The result is S1's `Point::Text { key, offset: Utf16Offset }` (S1 §9.1). A Rust client sends the op
as `SessionInput::Editor(lexical_model::Input)` (S1 §15): `Input::Command { command, selection:
ViewSelection::Range { anchor, focus, resolution_dirty: false } }` with `Type` →
`Command::InsertText`, `Backspace` → `Command::DeleteCharacter { direction: EditDirection::Backward,
target: ModifyTarget::ModelSegmentation }` per count (feature `model-segmentation` enabled in
`sync_sim`; `NoView` is headless upstream's early return and would delete nothing), `DeleteRange` → `Command::RemoveText`, `SplitBlock` →
`Command::InsertParagraph`, `Format` → `Command::FormatText(format)`, `Indent`/`Outdent` →
`Command::{IndentContent, OutdentContent}`; `Select` → `Input::SelectionFromView`; `Undo`/`Redo` →
`Input::{Undo, Redo}`, which S7 §2.2 handles over Loro's `UndoManager`. A Headless client
(`ClientKind::AiWorker` on `Current`) must send `ViewSelection::KeepModel` in the `selection`
field (S1 §15.1 step 1b), so it sends `Input::Batch([SelectionFromView(range), Command { command,
selection: KeepModel }])` instead. Ops without a core command (`SetBlock`, `ToggleList`,
`InsertTable`, `PasteMarkdown`, `MarkdownShortcut`) go through the S3 package commands (list, table,
markdown, as `Command::Extension` or the typed key commands); comments go through S7 §2.5.

### 2.3 Run and settle semantics

- **`Run(ms)`** pops and processes every scheduled event with `at ≤ now + ms`, in order, then
  sets `now += ms`. Per-step checks run after each step.
- **`Settle`** works in four stages.
  1. **Heal:**
     - clear partitions, offline flags, drop and corrupt rules;
     - set `NetProfile` to the calm profile (no breaks, no hostile);
     - heal storage and server faults; thaw every frozen client;
     - signal `Online` and `Visible` to every live client;
     - every live editor client re-sends its current selection (for `presence_converged`).
     Clock skews and grants are not faults and stay.
  2. **Run to quiescence.** Quiescent means all of these hold:
     - no scheduled event except periodic ones (heartbeat ping/pong, snapshot tick,
       presence refresh, presence expiry);
     - every live client that is not in a terminal `Closed(_)` has `SyncCore::is_idle()`
       (S7 §1.7: connected or `TransportKind::None`, every unparked WAL entry drained, no
       in-flight push or request, no pending import, no due rebase). Parked rows (read-only,
       poison, gap) do not block quiescence; they are reported as `RowsParked`. Terminal
       clients are excluded and reported in `Finals`;
     - the server has no pending write and no gated send;
     - the above has held for one full heartbeat interval.

     Pings and snapshot ticks keep the queue non-empty forever, so quiescence is a predicate
     over state, not an empty queue. Each client logs `ClientSettled` when it first becomes
     idle within this stage. The sim records a `PresenceSnapshot` at the first instant of
     quiescence, before the hold, so presence expiry during the hold doesn't hide divergence.
  3. If quiescence is not reached within `budgets.settle`, log `SettleTimedOut{busy}` with a
     reason per client (`PendingImport | Undelivered | InFlight | NotConnected | Rebasing`, from
     `SyncCore::busy()`). That is a **liveness failure** (invariant `settled`).
  4. Log `Settled`.
- **Finals pass**, after the last step:
  1. Record `Finals`.
  2. Run `budgets.quiet` more virtual time, recording events, for `quiet`.
  3. Record `Finals` again. They must equal the first ones.

---

## 3. `Outcome`: raw facts plus finals

Invariants never look inside a running sim. They query facts.

```rust
pub struct Outcome {
    pub seed: u64,
    pub script: Vec<Step>,
    pub events: Vec<Event>,          // in time order
    pub server_ports: Vec<(CallbackIx, sync_server_sim::Effect)>, // the room's port log (S6 §2.6)
    pub finals: Finals,
    pub quiet_events: Vec<Event>,    // events during the finals' quiet window
    pub finals_after_quiet: Finals,
    pub trace_hash: TraceHash,
    pub stats: RunStats,
    pub per_step_failures: Vec<Failure>,
    pub quirk_hits: Vec<(&'static str, Failure)>,
}

pub enum Event {
    Opened { at: Millis, client: ClientName, session: SessionId, peer: PeerID, build: ClientBuild, kind: ClientKind, user: UserName, access: Access, doc: DocIx },
    /// Every peer a session takes: the initial one, each reset, each comment fork, each W-11
    /// probe (S7 PE-1). Mapped from S7's `TelemetryRecord peer.assigned{peer, purpose}`.
    PeerAssigned { at: Millis, client: ClientName, session: SessionId, peer: PeerID, purpose: PeerPurpose },
    LocalOp { at: Millis, client: ClientName, op: AbstractOp, spans: Vec<IdSpan> },   // ops this edit created
    /// Every own-peer vv delta after a `handle`, whatever caused it: edits, the Init write-back
    /// (S7 §2.2), rebases, undo, comment publication, `FORCE_SYNC`. `no_future_vv` keys on it.
    LocalCommit { at: Millis, client: ClientName, peer: PeerID, spans: Vec<IdSpan>, cause: CommitCause },
    OpSkipped { at: Millis, client: ClientName, reason: SkipReason },
    UndoApplied { at: Millis, client: ClientName, redo: bool, removed: Vec<IdSpan>, restored_chars: u32 },
    WalAppendIssued { at: Millis, client: ClientName, session: SessionId, seq: WalSeq, spans: Vec<IdSpan>, foreign: bool },
    WalDurable { at: Millis, profile: ProfileName, session: SessionId, seq: WalSeq },
    WalWriteLost { at: Millis, profile: ProfileName, session: SessionId, seq: WalSeq },
    /// `map` renumbers `from`'s seqs to `to`'s, so later events on adopted rows join back to
    /// the original `WalAppendIssued`.
    WalAdopted { at: Millis, profile: ProfileName, from: WalOwner, to: SessionId, rows: u32, map: Vec<(WalSeq, WalSeq)> },
    /// S7 `wal.expired`; seqs map to `WalAppendIssued.spans` (through `WalAdopted.map`).
    WalExpired { at: Millis, client: ClientName, owner: WalOwner, seqs: Vec<WalSeq>, reason: DiscardReason },
    /// From the session's `parked()` whenever it changes (S7 §1.7): read-only, poison, gap, needs-rebase.
    RowsParked { at: Millis, client: ClientName, seqs: Vec<WalSeq>, reason: ParkReason },
    /// `rows` names the owner of each row: assist pushes carry another session's seqs.
    PushSent { at: Millis, client: ClientName, update: UpdateId, rows: Vec<(WalOwner, WalSeq)>, assist: bool, foreign_bytes: u32, own_bytes: u32 },
    RebaseStarted { at: Millis, client: ClientName, cause: ImportOrigin }, RebaseFinished { at: Millis, client: ClientName, ok: bool },
    /// `spans` = `LoroDoc::decode_import_blob_meta` over each update in the batch.
    ServerApplied { at: Millis, update: UpdateId, spans: Vec<IdSpan>, pending: bool },
    ServerDurable { at: Millis, update: UpdateId },
    AckSent { at: Millis, update: UpdateId },              // at output-gate release
    AckReceived { at: Millis, client: ClientName, update: UpdateId },
    UpdateRefused { at: Millis, update: UpdateId, reason: RefuseReason },
    CommentSent { at: Millis, client: ClientName, request: RequestId, mark_id: MarkId, update: UpdateId, spans: Vec<IdSpan> },
    CommentReplied { at: Millis, client: ClientName, request: RequestId, reply: CommentReply },
    Imported { at: Millis, client: ClientName, origin: ImportOrigin, outcome: ImportOutcome },
    Converge { at: Millis, client: ClientName, attempt: u8, result: ConvergeResult },
    ResetStarted { at: Millis, client: ClientName }, ResetFinished { at: Millis, client: ClientName, ok: bool },
    Connection { at: Millis, client: ClientName, status: ConnectionStatus },
    AccessChanged { at: Millis, client: ClientName, access: Access },
    PresenceChanged { at: Millis, client: ClientName, remote: Vec<PresenceKey> },
    Frame { at: Millis, from: Node, to: Node, kind: FrameKind, bytes: u32, frames: u16, fate: Fate },
    Crashed { at: Millis, client: ClientName }, ProfileCrashed { at: Millis, profile: ProfileName, mode: CrashMode },
    Frozen { at: Millis, client: ClientName }, Thawed { at: Millis, client: ClientName },
    Closed { at: Millis, client: ClientName },
    ServerEvicted { at: Millis }, ServerRestarted { at: Millis }, ServerCrashed { at: Millis, after_port_calls: u16 },
    EditDiscarded { at: Millis, client: ClientName, spans: Vec<IdSpan>, reason: DiscardReason },
    Reply { at: Millis, client: ClientName, request: RequestId, reply: Reply },
    ClientSettled { at: Millis, client: ClientName, session: SessionId },
    Settled { at: Millis }, SettleTimedOut { at: Millis, busy: Vec<(ClientName, BusyReason)> },
}

/// A Loro id range: (peer, counter start, len).
pub struct IdSpan { pub peer: PeerID, pub start: Counter, pub len: u32 }

pub enum ImportOutcome { Applied, NoChange, Pending, Failed }
pub enum ConvergeResult { Applied, Empty, StillPending, TimedOut }
pub enum FrameKind { RegisterId, Update, CommentUpdate, Awareness, RequestSince, RequestSnapshot,
                     InitialSync, RemoteUpdate, Ack, UpdateSince, Snapshot, Ping, Pong, Router }
pub enum Fate { Delivered, Dropped, Lost, Corrupted }
pub enum Direction { ToServer, ToClient }
pub enum Node { Client(ClientName), Server, Router(ProfileName) }
pub enum SkipReason { NoTarget, ReadOnly, NotReady }
pub enum RefuseReason { NoWriteAccess, GateRefused, GateError, GateTimeout, SourceBlocked }
/// Poison is no longer a discard: S7 W-11 parks the row (`RowsParked{Poison}`) and only TTL
/// ever removes it, as `TtlExpired`.
pub enum DiscardReason { TtlExpired, Revoked }
pub enum ParkReason { ReadOnly, Poison, Gap, NeedsRebase }
pub enum PeerPurpose { Initial, Reset, CommentFork, Probe }
pub enum CommitCause { Edit, Init, Undo, Comment, Rebase }
pub enum CrashMode { ProcessDeath, PowerLoss { window: Millis } }

pub struct Finals {
    pub clients: BTreeMap<ClientName, ClientFinal>,
    pub server: ServerFinal,
    pub profiles: BTreeMap<ProfileName, StoreImage>,
    pub presence: Option<PresenceSnapshot>,   // taken at the first instant of quiescence (§2.3)
}
pub struct ClientFinal {
    pub alive: bool, pub terminal: Option<CloseReason>, pub access: Access, pub build: ClientBuild, pub kind: ClientKind,
    pub oplog_vv: VersionVector, pub deep_value: LoroValue,
    pub editor_synced_json: Option<serde_json::Value>,   // macro_document_model::synced_json
    pub projected_json: Option<serde_json::Value>,       // the editor JSON lexical_loro derives from this client's doc
    pub wal_undelivered: u32, pub status: SyncStatus, pub pending_import: bool,
}
pub struct ServerFinal {
    pub oplog_vv: VersionVector, pub deep_value: LoroValue, pub editor_json: serde_json::Value,
    pub pending_import: bool,
    /// Built from a **fresh** `Room` over a clone of the durable `SimPorts` storage (snapshot +
    /// `o/`), loaded, then `oplog_vv` read. Never the live room: this is what a cold room loads.
    pub persisted_vv: VersionVector,
    pub active_peers_without_ai: Vec<PeerID>,   // `Room::active_peers(false)`
}
/// Each live editor client's remote list, and each remote cursor resolved to (block index, utf16 offset).
pub struct PresenceSnapshot { pub at: Millis, pub views: BTreeMap<ClientName, BTreeMap<PresenceKey, Option<(u32, u32)>>> }
```

- `LocalOp.spans` comes from the client's own-peer vv before and after the edit's commit.
- `UndoApplied.removed` is the Loro ids of the text and nodes that the undo or redo removed
  from the visible document, found by diffing the deep value before and after and mapping each
  removed element to its Loro id.
- `PushSent`, `ServerApplied` and `WalAppendIssued` carry spans or `(owner, seq)` rows, so
  every invariant is a join over ids. No invariant compares bytes.
- `ServerFinal::markdown()` and `ClientFinal::markdown()` run `macro_document_model`'s markdown
  export over `editor_json` / `editor_synced_json`.

---

## 4. Invariants: query functions

### 4.1 The list

Every invariant has the type `fn(&Outcome) -> Result<(), Failure>`. They are plain
functions, so a story test can call one alone.

```rust
pub struct Failure { pub invariant: &'static str, pub at: Option<Millis>, pub detail: String }
pub const ALL_INVARIANTS: &[(&str, fn(&Outcome) -> Result<(), Failure>)] = &[
    ("settled", settled),
    ("all_docs_equal", all_docs_equal),
    ("editor_states_equal", editor_states_equal),
    ("projection_consistent", projection_consistent),
    ("no_acked_edit_lost", no_acked_edit_lost),
    ("no_persisted_edit_lost", no_persisted_edit_lost),
    ("no_edit_lost_without_crash", no_edit_lost_without_crash),
    ("no_dependency_stuck", no_dependency_stuck),
    ("all_wals_drained", all_wals_drained),
    ("quiet", quiet),
    ("core_acks_after_writes", core_acks_after_writes),
    ("gate_releases_after_durable", gate_releases_after_durable),
    ("refused_updates_never_applied", refused_updates_never_applied),
    ("comment_replies_truthful", comment_replies_truthful),
    ("ai_peers_hidden", ai_peers_hidden),
    ("presence_converged", presence_converged),
    ("presence_expires", presence_expires),
    ("undo_reverts_only_own", undo_reverts_only_own),
    ("no_transient_quarantine", no_transient_quarantine),
    ("no_spurious_terminal", no_spurious_terminal),
    ("per_step", per_step),
];

/// Runs every invariant and applies `config.quirks` (§4.2).
pub fn check_all(outcome: &Outcome) -> Result<(), Vec<Failure>>;
```

| Invariant | Definition (over `Outcome`) |
| --- | --- |
| `settled` | the last `Settle` produced `Settled`, not `SettleTimedOut` |
| `all_docs_equal` | every live, non-terminal client with `Edit` or `CommentOnly` access, plus the server, has an equal `oplog_vv` **and** an equal `get_deep_value()`. **Not snapshot bytes:** change boundaries, peer order and shallow roots differ legitimately. Read-only clients must have `oplog_vv ≥` every other client's vv they could see; they receive all ops, so in practice they are equal too. |
| `editor_states_equal` | every live editor client's `editor_synced_json` is equal, and equal to `server.editor_json`. `synced_json` (S11 §1.2) strips per-peer state only: `$.local` (written by `local-status` commits; a `$` with only local keys counts as absent), `completion` nodes, draft comment marks (transparent), and the selection. It **keeps** `$.sharedPeerIds`, which TS syncs (`loroSyncState`) as co-ownership. |
| `projection_consistent` | for every live client, `projected_json == editor_synced_json`: the editor model and its own LoroDoc agree. Checked again per step (§5). |
| `no_acked_edit_lost` | for every `AckReceived{update}`, the spans of the matching `PushSent`/`ServerApplied` are contained in `server.persisted_vv` and in the `oplog_vv` of every live client that logged `ClientSettled` and whose access (from `Opened.access`, then its last `AccessChanged`) is not `Read`-by-revocation at the end |
| `no_persisted_edit_lost` | for every `WalDurable{profile, session, seq}` without a later `WalWriteLost` for it, the spans of `WalAppendIssued{session, seq}` are in `server.persisted_vv`, **if** after that time the profile hosted a session of the same user that logged `ClientSettled` with `Edit` access, and no `EditDiscarded`/`WalExpired` covers them. It is the crash-survival guarantee, including adoption and foreign rows (S7 §3.5, W-10). |
| `no_edit_lost_without_crash` | for every `LocalOp` by a client never crashed and never in a crashed profile, its spans are in `server.persisted_vv` unless `EditDiscarded` covers them or they sit in rows parked at the end (`RowsParked`) of a session whose last `AccessChanged` is `Read`/`CommentOnly` (or parked as `Poison` in a run with a corruption fault). This catches drops inside the coalesce window and across resets (S7 I-3 step 0) that are not crash-related. |
| `no_dependency_stuck` | no live client and not the server ends with `pending_import`. A failure names the missing span. Catches the chatter dependency hole (S7 W-10) and the server's pending-compaction quirk (A4, allowlisted until S6 PR 6). |
| `all_wals_drained` | every live, non-terminal client has `wal_undelivered == 0` counting only unparked rows. In every profile with a live `Edit` session of the same user for the doc, `StoreImage` has no undelivered, non-quarantined row, whether own, foreign or orphan. Rows parked at the end of a session whose last `AccessChanged` is `Read`/`CommentOnly` are exempt. |
| `quiet` | `quiet_events` has no `Frame` of kind `Update`, `CommentUpdate`, `RequestSince`, `RequestSnapshot`, `Snapshot` or `UpdateSince`; no `Connection` change; no `WalAppendIssued`; and `finals_after_quiet == finals`. Only pings, pongs and presence refreshes are allowed. This catches resend loops and convergence ping-pong. |
| `core_acks_after_writes` | in `server_ports`, within each callback, every update's `put(o/…)` and the `map_unowned_peers` call **precede** the `Send(Ack)` for it. This tests the core's M9 ordering, not the fake. |
| `gate_releases_after_durable` | harness self-check: every `AckSent{u}` is preceded by `ServerDurable{u}`, and no send is released before an earlier write of its callback is durable. |
| `refused_updates_never_applied` | spans of an `UpdateRefused` update appear in no final vv unless they were also delivered in an accepted update (a comment-only peer's valid retry). This is the comment-only gate's safety property. |
| `comment_replies_truthful` | every `CommentSent` gets exactly one `CommentReplied`; `Accepted` ⇒ its spans are in `server.persisted_vv`; `Refused(_)` ⇒ its spans are in no final vv unless a later `CommentSent` with the same `mark_id` was accepted. `NotAcked` is exempt: a lost ack whose update the server applied is legitimate, and the retry finds the mark already placed and sends nothing. |
| `ai_peers_hidden` | `server.active_peers_without_ai` contains no peer of an `AiWorker` client, and every `AiWorker` peer is in the AI range (S7 PE-4). |
| `presence_converged` | grouped by document (`Opened.doc`): in `finals.presence`, each live editor client's remote list equals the set of other live clients **of the same `DocIx`** (AI workers included) that have a selection, and each remote cursor resolves to the same (block, offset) on every client. Runs whose `ClockSkew` exceeds `PresencePolicy.timeout / 2` are exempt: they exercise the documented skew drop instead (S7 P-1). |
| `presence_expires` | after `Crashed{client}` (or a partition that outlasts it), the client's presence key disappears from every other live client's list within `PresencePolicy.timeout + max latency + |skew|` (`PresenceChanged` events). |
| `undo_reverts_only_own` | for every `UndoApplied{client: X, removed}`, `removed` is contained in the spans of `LocalOp`s by X's own peers (every `PeerAssigned` of X's sessions). An undo that reverts another user's edit converges fine, so only this catches it. |
| `no_transient_quarantine` | no `RowsParked{reason: Poison}` in a run without `Storage(CorruptRow)`, `Net(CorruptNext)` or a `Faulty` client. D1 outages, storage errors, View-token connections and lost acks never quarantine (S7 W-11). |
| `no_spurious_terminal` | `Closed(Corrupt)` happens only in runs with a `Faulty` client or a corruption fault. `Outdated` imports rebase, never close (S7 I-2'). Terminal clients are excluded from the data invariants, so only this catches reset storms. |
| `per_step` | `per_step_failures` is empty |

### 4.2 Known server quirks

`check_all` runs every invariant. A failure for which some `KnownServerQuirk` in
`config.quirks` lists that invariant and whose `matcher` returns true moves to
`quirk_hits` instead of failing the run. Matchers are narrow: the H9 matcher requires an
`ExistsProbe` between two same-millisecond `o/` puts and a following eviction; the A4 matcher
requires a `ServerApplied{pending: true}` whose update is missing from `persisted_vv` after an
alarm. `RunStats.quirk_hits` counts them per id. The allowlist shrinks as S6 fixes land, and a
quirk with zero hits over a full T2 run is flagged for review.

---

## 5. Per-step invariants

These run on live state after every `Step` and after every 1,000 processed events inside a
long `Run`. A failure is recorded with the step index, and the run continues, so the finals
still print.

| Check | Holds after every step |
| --- | --- |
| `projection_consistent_live` | each live editor's model equals its doc's projection (the cheap incremental form: only the nodes dirty since the last check) |
| `editor_well_formed` | the `lexical_model` structural invariants (SCOPE §4 Tier C 4): tree consistency, no adjacent mergeable text, selection keys exist |
| `wal_well_formed` | WAL seqs strictly increase, `delivered_through ≤ last seq`, at most one own push in flight, the in-flight range is a contiguous pushable run above `delivered_through` (S7 W-2/W-3), and no push exceeds 256 KiB or 64 entries |
| `durable_prefix_monotone` | in every profile, each owner's delivered prefix (the longest run of `delivered` rows from its lowest seq) never shrinks except by prune or adoption |
| `no_future_vv` | no client vv includes an op id beyond the max counter that the owning peer (from `PeerAssigned`, any session) has created, as recorded by `LocalCommit` (no counter reuse, S7 PE-1) |
| `status_truthful` | `SaveState::Saved` ⇒ `wal_undelivered == 0` counting parked rows, no `RowsParked` outstanding, no rebase in flight, storage healthy and `pending_import == false` (S7 §1.5); `ConnectionStatus::Connected` ⇒ the sim link is open |
| `server_stalled` | no `step` returned a stalled callback without a crash (§1.4) |

---

## 6. Determinism

- **Guard.** `trace_hash = xxh3_64` over a canonical postcard encoding of `events`,
  `server_ports` and `finals`. A determinism check calls `Sim::run` twice with the same
  `(config, script)` and requires equal hashes. It runs on 1 in 16 proptest cases and on every
  story. A mismatch fails with the first differing event index.
- **Sources of nondeterminism, and how each is closed.**
  1. Clocks: all from `SimClock` (S7 D-1); the server's `Clock` is `SimPorts`' (S6 §2.6).
  2. Loro: S7 D-4 (a)–(e): `record_timestamp` off with explicit `commit_with` timestamps,
     `set_peer_id` right after every `new`/`fork`, no detached editing, no
     `UpdateOptions.timeout_ms`, `merge_interval = 0`, and `sync_protocol::presence` on both
     sides. The guard is the backstop, but it can't see a *deterministic* misuse (a real-time
     presence store in a virtual-time sim drops every presence identically each run), which is
     why `presence_converged` exists.
  3. Randomness: peer ids, session ids and colours from the sim RNG. Message ids are derived.
  4. Iteration order: `BTreeMap` everywhere in the sim (S7 D-3).
  5. Threads: none.
  6. The TS peer: fake timers, seeded `Math.random`, a counter `crypto.randomUUID`, and a
     seeded `crypto.getRandomValues` (loro-crdt draws peer ids from it) (§7.2).
- **Seeds are the unit of reproduction.** A failure prints `SIM_SEED=<u64>` and the shrunk
  script. `SIM_SEED=… cargo test -p sync_sim replay` reruns it with full event-log output.

---

## 7. Mixed-version runs and wire compatibility

Clients and servers of different versions talk real bebop bytes over the sim network, so wire
compatibility is genuinely tested. Examples: `PeerCommentUpdate` sent to an older server
that rejects it, and new `ChatterMessage::Closing` received by old tabs.

`ServerBuild::Current` is the real `sync_server_core`. It stands for today's deployed Durable
Object only once S6's transcript proof holds (C16 merged, every transcript enabled in native
replay). Until then T1/T2 server results speak for the core, and §7.4 is the link to the real
worker.

### 7.1 Pinned N-1 Rust builds

- A version-stable driver protocol, `crates/sim_peer_protocol`, is an append-only postcard
  enum. Its variants are never removed or reordered.

  ```rust
  pub enum PeerCommand { Open { config: WireSessionConfig }, Edit(AbstractOp), Socket { conn: u32, event: WireSocketEvent },
                         Storage(WireStorageEvent), Token(WireTokenEvent), Chatter(Vec<u8>), Host(u8), Tick { now: u64, wall: i64 },
                         Finals }
  pub enum PeerReport { Io(Vec<WireIoEffect>), WakeAt(Option<u64>), Events(Vec<WireEvent>), Finals(WireClientFinal) }
  ```

- `sync_sim_peer` is a tiny binary wrapping `document_session` behind that protocol over
  stdin/stdout, as length-prefixed frames. CI builds it at the previous release tag (a git
  worktree), caches it by tag (kache), and the sim spawns it once per pinned client.
- `sync_sim_server_peer` does the same for `sync_server_core` N-1 (exists only after S6 lands).
- Lockstep: the sim sends one command and waits for one report. The child has no clock and
  no other input, so the run stays deterministic.

### 7.2 Today's TypeScript stack via node

`tooling/sync-sim/ts-peer.ts` speaks `sim_peer_protocol` over stdio (JSON-framed in the same
envelope). It hosts today's code as it ships:

- `LoroManager` (with `MARKDOWN_LORO_SCHEMA`), `SyncEngine`, `WALSyncer` over
  `BrowserWALStore`, using `fake-indexeddb` so crashes keep committed rows;
- `SyncServiceSource` over a `SimSyncSocket` that implements `SyncSocket` and forwards
  frames to stdout;
- a headless Lexical editor with the **ai-editing-worker** binding (`queueMicrotask`
  `onStateUpdate`), reusing the collab fuzzer's (#8309) command set to apply `AbstractOp`.

Fidelity: this is the worker's binding, not CollabProvider's. "Old web client" results
therefore cover the engine, the WAL and the sync source, not the web reconcile. With
`ClientKind::AiWorker` it is the shipping ai-editing-worker path (S7 row 114).

Determinism:

- `@sinonjs/fake-timers` is installed before any import.
- After each command the peer drains: `await clock.runToLastAsync()` loops until no timer is
  due at `now` and the microtask queue is empty, then reports `clock.next()?.callAt` as
  `WakeAt`.
- `Math.random` is seeded, `crypto.randomUUID` is a counter, and `crypto.getRandomValues` fills
  from a seeded PRNG. Loro peers are set with `doc.setPeerId`, and
  `SyncServiceSourceOptions.newId` is a counter.

What it proves:

- a new client and an old client edit together;
- a new client adopts `Legacy` rows written by the TS WAL in the same profile, and an old tab
  keeps delivering rows the new bundle wrote (rollback safety, S7 §3.5);
- BroadcastChannel interop.

`StoreImage` maps v1 `updates` rows with no `owner` to `WalOwner::Legacy`.

### 7.3 Matrix

| Clients | Server | Tier |
| --- | --- | --- |
| Current × 3 | Current | T0 |
| Current + Pinned(N-1) | Current, Pinned(N-1) | T1 |
| Current + TypeScript (same and different profiles), incl. TypeScript `AiWorker` | Current | T2 |
| Pinned(N-1) only | Current (old clients against a new server: the deploy-day case) | T1 |
| Current, TypeScript | deployed sync-service in Miniflare (§7.4) | T2 |

Every Rust session editor is built as S7 §2.2 builds it: `opaque_unknown_types(true)` (S1 D-23
ruling), the host given by `EditorBuilder::view_host` (S1 §15; `CoreConfig` has no platform
field), and `EditorCore::take_initial_output` drained and projected once before the client's
first step (S1 §15, S11 §5.1). With the option on, a `Pinned(N-1)` client that meets a node type added in `Current` keeps it as an opaque record
and `editor_states_equal` still holds. A session built with the option off fails with
`UnknownSerializedType`; that is a finding, not a skip.

### 7.4 Wire compatibility with the deployed sync-service

The fuzz server is the core, and S6's golden transcripts were recorded with **TS** clients, so
nothing above proves that the new Rust client's frame *sequences* are what today's worker
expects. Two checks close that.

1. **Client golden transcripts** (T1). `tooling/sync-sim/client-transcripts/` holds ~20
   scripted user scenarios: open and type; reconnect after a break (peer re-registration
   before replayed pushes); a pending import and its `RequestSince` (vv encoding); a comment as
   a commenter (`PeerCommentUpdate` framing); a reset (`RequestSnapshot`); a flush; a > 900 KB
   paste (multi-frame). Each runs against a scripted server that answers from the S6 C0
   transcripts. The TS stack (ts-peer) and the Rust `DocumentSession` run the same scenario, and
   their outbound frames are compared after decoding, with update and session ids masked: the
   sequence of frame kinds must be identical, and payloads must be semantically equal (vv
   decoded; `RegisterId` sets equal; updates compared by the op spans they contain, unioned per
   push because S7 W-1 coalesces commits). Differences are allowed only where an S7 §6 Δ row is
   cited in the scenario's allowlist (for example row 2's coalescing and row 110's initial-sync
   awareness import).
2. **Deployed worker under Miniflare** (T2). CI builds `services/sync-service` at the git tag
   of the last production sync-service deploy and runs it in Miniflare (workerd). A
   `MiniflareServer` replaces `SimServer` behind a `SimNetwork` ↔ WebSocket adapter, and a
   handful of stories (the three in §10.1, a comment-only story, a reset story) run against
   it. workerd can't run on virtual time, so these runs use real time with the calm profile,
   skip the determinism guard, and check only finals invariants (`settled`, `all_docs_equal`,
   `editor_states_equal`, `no_acked_edit_lost`, `refused_updates_never_applied`).

---

## 8. Failures become explicit story tests

1. A proptest failure shrinks. Steps are deleted, `Ix`/`Millis`/counts move toward 0, and
   `ClientBuild` moves toward `Current`. Shrinking never invalidates a script (§2.2).
2. The failure message includes `Outcome::story_source("<name>")`: a complete Rust `#[test]`
   with the literal steps, the seed, and the failing invariant asserted, in the exact style
   of §10. It also prints the last 50 events.
3. The developer names the story, commits it under `crates/sync_sim/tests/stories/`, tags it
   with the S7 rows it covers, fixes the bug, and the story stays forever. proptest's own
   `regressions/` file is committed too, but the story is the readable record.
4. Nightly failures (T2) upload the printed story, seed and full event log as a CI artifact,
   and open an issue titled with the invariant name.

---

## 9. Generator stats and conformance

### 9.1 `RunStats` and coverage floors

```rust
pub struct RunStats {
    pub steps: u32, pub ops_by_kind: BTreeMap<&'static str, u32>, pub skipped_ops: u32,
    pub crashes: u32, pub profile_crashes: u32, pub server_crashes: u32, pub reconnects: u32, pub gave_up: u32,
    pub resets: u32, pub pending_imports: u32, pub converge_rounds: u32, pub acks_lost: u32,
    pub wal_max_depth: u32, pub adoptions: u32, pub assisted_pushes: u32, pub foreign_rows: u32,
    pub comment_refusals: u32, pub undos: u32, pub multi_frame_messages: u32, pub access_changes: u32,
    pub quirk_hits: BTreeMap<&'static str, u32>, pub settle_ms: u64, pub frames: u64,
    pub rebases: u32, pub parked_rows_at_end: u32, pub multi_edit_tab_profiles: u32,
    pub late_commits_after_lock_release: u32, pub d1_outages: u32, pub close_in_window: u32,
    /// Bytes of foreign rows pushed vs own rows pushed (S7 W-10.5); asserted ≤ 0.2 in calm runs.
    pub foreign_bytes_pushed: u64, pub own_bytes_pushed: u64, pub backspaces: u32, pub backspaces_with_spans: u32,
}
```

`generator_coverage` is a plain `#[test]`, not proptest. It runs 2,000 scripts from seeds
`0..2000` through `script_strategy` and asserts floors over the aggregate, so a generator
change can't silently stop reaching a path:

| Path | Floor |
| --- | --- |
| runs with ≥ 1 crash | ≥ 20% |
| runs with a reset (reachable through `CorruptNext`, `Storage(CorruptSnapshot)`, `Server(CorruptSnapshot)` and `Faulty` peers) | ≥ 3% |
| runs with a pending import | ≥ 10% |
| runs with an adoption | ≥ 5% |
| runs with a foreign (chatter) row | ≥ 5% |
| runs with `GaveUp` | ≥ 1% |
| runs with a lost ack | ≥ 10% |
| runs with a multi-frame message | ≥ 5% |
| runs with an access change | ≥ 2% |
| runs with an undo after a remote edit in the same block | ≥ 5% |
| runs with a server crash or hibernate | ≥ 2% |
| skipped-op ratio | ≤ 15% (abstract positions resolve) |
| `Backspace` ops that create spans | ≥ 90% |
| runs with a rebase (S7 I-2') | ≥ 10% |
| runs with ≥ 2 `Edit` tabs of one doc in one profile | ≥ 10% |
| runs with a parked row at the end | ≥ 2% |
| runs with a late commit after lock release (`Crash` with pending writes) | ≥ 2% |
| runs with `Server(D1Outage)` or `Server(StorageErrors)` | ≥ 3% |
| runs with `Close` inside the coalesce window | ≥ 5% |
| `foreign_bytes_pushed / own_bytes_pushed` in calm runs | ≤ 0.2 |

### 9.2 Executor and storage conformance

- **Executor traces** (S7 R-5). `record_effect_traces` writes sim client I/O traces for 20
  fixed seeds to `tests/executor-traces/*.json`. A vitest suite replays each trace through the
  TS `SessionExecutor` with a fake WebSocket, fake IndexedDB and fake timers. It requires the
  same sequence of session inputs (`socketOpened`, `storageDone`, …) that the sim fed. That
  keeps the two executors from drifting.
- **Real browsers.** The SC-1..9 suite and one crash-adoption story (§10.2
  `crash_after_durable_wal_append_delivers_on_reopen`'s storage half) also run in Playwright
  Chromium and WebKit against real IndexedDB, Web Locks and BroadcastChannel. Crashes use CDP
  `Page.crash` (Chromium) and `page.close({runBeforeUnload: false})` (both), so transactions
  aborted on tab close and WKWebView IndexedDB quirks are exercised. S4 §6.2 runs them.

---

## 10. Story tests

### 10.1 Complete stories

```rust
// crates/sync_sim/tests/stories/crash_after_durable_append.rs
use sync_sim::{prelude::*, invariants::*};

/// A tab types while partitioned, its WAL append becomes durable, then the tab dies.
/// The reopened session must adopt the dead session's orphaned row, deliver the edit,
/// and the other client must see it.
/// covers: S7:36, S7:25
#[test]
fn crash_after_durable_wal_append_delivers_on_reopen() {
    let outcome = Sim::new(SimConfig {
        seed: 7,
        document: SeedDocument::Markdown("Hello"),
        ..SimConfig::calm(7)
    })
    .run(&[
        Step::Open(OpenSpec::editor("a", "laptop")),
        Step::Open(OpenSpec::editor("b", "phone")),
        Step::Settle,
        Step::Net(NetStep::Partition(ClientName("a"))),
        Step::Edit { client: ClientName("a"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(5) }, text: SimText::Literal(" world") } },
        Step::Run(Millis(200)),
        Step::Crash { client: ClientName("a") },
        Step::Net(NetStep::Heal(ClientName("a"))),
        Step::Reopen { client: ClientName("a") },
        Step::Settle,
    ]);

    let crashed_at = outcome.events.iter().find_map(|event| match event {
        Event::Crashed { at, client: ClientName("a") } => Some(*at),
        _ => None,
    });
    let durable_at = outcome.events.iter().find_map(|event| match event {
        Event::WalDurable { at, profile: ProfileName("laptop"), .. } => Some(*at),
        _ => None,
    });
    assert!(matches!((durable_at, crashed_at), (Some(durable), Some(crashed)) if durable < crashed));
    assert!(outcome.events.iter().any(|event| matches!(event, Event::WalAdopted { profile: ProfileName("laptop"), rows: 1, .. })));

    if let Err(failures) = check_all(&outcome) {
        panic!("{failures:#?}");
    }
    assert_eq!(outcome.finals.server.markdown(), "Hello world\n");
    assert_eq!(outcome.finals.clients[&ClientName("b")].markdown(), "Hello world\n");
}
```

```rust
// crates/sync_sim/tests/stories/lost_ack_resend.rs
use sync_sim::{prelude::*, invariants::*};

/// The server makes a's update durable but the ack is lost. a resends after the ack timeout,
/// while b turns its paragraph into a quote. The resend must be harmless, both edits must
/// survive, and the system must go quiet (no resend loop).
///
/// Exactly one resend: a's push goes out ~25 ms after the edit; its ack is dropped; the 5 s
/// ack deadline returns the push to `Idle{retry_at: now + 5_000}` (S7 W-5); the resend fires at
/// the earlier of `retry_at` and the next 5 s snapshot tick; `LoseAcks{count: 1}` lets that
/// second ack through, so nothing else is resent inside `Run(10_000)`.
/// covers: S7:30, S7:53
#[test]
fn lost_ack_resends_once_and_converges_with_concurrent_edit() {
    let outcome = Sim::new(SimConfig {
        seed: 11,
        document: SeedDocument::Markdown("one\n\ntwo"),
        ..SimConfig::calm(11)
    })
    .run(&[
        Step::Open(OpenSpec::editor("a", "a")),
        Step::Open(OpenSpec::editor("b", "b")),
        Step::Settle,
        Step::Net(NetStep::LoseAcks { client: ClientName("a"), count: 1 }),
        Step::Edit { client: ClientName("a"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(3) }, text: SimText::Literal("!") } },
        Step::Run(Millis(1_000)),
        Step::Edit { client: ClientName("b"),
                     op: AbstractOp::MarkdownShortcut { block: Ix(1), shortcut: Ix(2) } },   // "> "
        Step::Run(Millis(10_000)),
        Step::Settle,
    ]);

    let pushes_from_a: Vec<&UpdateId> = outcome.events.iter().filter_map(|event| match event {
        Event::PushSent { client: ClientName("a"), update, .. } => Some(update),
        _ => None,
    }).collect();
    assert_eq!(pushes_from_a.len(), 2, "one original push and exactly one resend");

    let acks_to_a = outcome.events.iter().filter(|event| matches!(event, Event::AckReceived { client: ClientName("a"), .. })).count();
    assert_eq!(acks_to_a, 1);

    if let Err(failures) = check_all(&outcome) {
        panic!("{failures:#?}");
    }
    assert_eq!(outcome.finals.server.markdown(), "one!\n\n> two\n");
}
```

```rust
// crates/sync_sim/tests/stories/missed_broadcast_pending.rs
use sync_sim::{prelude::*, invariants::*};

/// b misses a's first update (the frame is dropped without a close) and then receives a's
/// second, which depends on the first. b's import is pending; b must pull the gap with
/// RequestSince instead of resetting, and converge.
/// covers: S7:16, S7:21
#[test]
fn missed_broadcast_is_pending_then_converged_without_reset() {
    let outcome = Sim::new(SimConfig {
        seed: 23,
        document: SeedDocument::Markdown("abc"),
        ..SimConfig::calm(23)
    })
    .run(&[
        Step::Open(OpenSpec::editor("a", "a")),
        Step::Open(OpenSpec::editor("b", "b")),
        Step::Settle,
        Step::Net(NetStep::DropNext { client: ClientName("b"), direction: Direction::ToClient,
                                     kind: Some(FrameKind::RemoteUpdate), frames: 1 }),
        Step::Edit { client: ClientName("a"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(3) }, text: SimText::Literal("d") } },
        Step::Run(Millis(500)),
        Step::Edit { client: ClientName("a"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(4) }, text: SimText::Literal("e") } },
        Step::Run(Millis(500)),
        Step::Settle,
    ]);

    assert!(outcome.events.iter().any(|event| matches!(
        event,
        Event::Imported { client: ClientName("b"), origin: ImportOrigin::Live, outcome: ImportOutcome::Pending, .. }
    )));
    assert!(outcome.events.iter().any(|event| matches!(
        event,
        Event::Converge { client: ClientName("b"), result: ConvergeResult::Applied, .. }
    )));
    assert!(!outcome.events.iter().any(|event| matches!(event, Event::ResetStarted { .. })));

    if let Err(failures) = check_all(&outcome) {
        panic!("{failures:#?}");
    }
    assert_eq!(outcome.finals.clients[&ClientName("b")].markdown(), "abcde\n");
}
```

The third story filters `DropNext` to `FrameKind::RemoteUpdate`. S7 P-2 sends presence once per
window in the same tick as the coalesced update, so an unfiltered drop could discard a's
awareness frame instead and leave the pending path untested. The first assertion
(`ImportOutcome::Pending`) fails loudly if the story ever stops reaching that path.

```rust
// crates/sync_sim/tests/stories/collaborative_undo.rs
use sync_sim::{prelude::*, invariants::*};

/// Alice types, Bob types in the same paragraph, Alice undoes. Only Alice's text goes; Bob's
/// survives on every client and on the server.
/// covers: S7:48
#[test]
fn undo_reverts_only_the_undoing_users_edit() {
    let outcome = Sim::new(SimConfig {
        seed: 31,
        document: SeedDocument::Markdown("start"),
        ..SimConfig::calm(31)
    })
    .run(&[
        Step::Open(OpenSpec::editor("alice", "alice")),
        Step::Open(OpenSpec::editor("bob", "bob")),
        Step::Settle,
        Step::Edit { client: ClientName("alice"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(5) }, text: SimText::Literal(" alice") } },
        Step::Run(Millis(500)),
        Step::Edit { client: ClientName("bob"),
                     op: AbstractOp::Type { at: Pos { block: Ix(0), offset: Ix(0) }, text: SimText::Literal("bob ") } },
        Step::Run(Millis(500)),
        Step::Edit { client: ClientName("alice"), op: AbstractOp::Undo },
        Step::Settle,
    ]);

    assert!(outcome.events.iter().any(|event| matches!(event, Event::UndoApplied { client: ClientName("alice"), redo: false, .. })));
    if let Err(failures) = check_all(&outcome) {
        panic!("{failures:#?}");
    }
    assert_eq!(outcome.finals.server.markdown(), "bob start\n");
    assert_eq!(outcome.finals.clients[&ClientName("bob")].markdown(), "bob start\n");
}
```

### 10.2 Named stories for the remaining S7 rows

Each is one literal script in `crates/sync_sim/tests/stories/`, written in the style above.
Rows marked "unit" are covered by a `doc_sync_core` unit test instead, mapped through S4 §0.1.

| Story | Steps that matter | Asserts | covers |
| --- | --- | --- | --- |
| `chatter_dependency_survives_writer_crash` | a, b in one profile; a types; b builds on the gossip; `Crash{a}` before a's push; `Settle` | b pushed a's bytes as a foreign row; `no_dependency_stuck`, `no_persisted_edit_lost` | S7:2, S7:122 |
| `frozen_tab_rows_assisted` | a, b in one profile; partition a; a types; `Freeze{a}`; heal; `Settle` without thaw | b's `PushSent{assist: true}` carries a's rows; after `Thaw{a}` a's own push is acked and idempotent | S7:121 |
| `reset_flushes_window_and_reset_time_edits` | `Net(CorruptNext{b, ToClient})`; b types during `Resetting` | `no_edit_lost_without_crash`; one `ResetStarted`, `ok: true` | S7:11, S7:9 |
| `reset_failure_restarts_on_old_doc` | corrupt the reset's `RemoteSnapshot` | `ResetFinished{ok: false}`, then a later successful reset | S7:12 |
| `reset_budget_closes_corrupt` | a `Faulty` peer keeps editing | b reaches `Closed(Corrupt)` after 3 started resets in 60 s; b's WAL is kept; reopen delivers it | S7:13 |
| `corrupt_local_snapshot_deleted` | `Storage(CorruptSnapshot)`; `Reopen` | `SnapshotDelete` issued; remote seed wins; converge | S7:39 |
| `corrupt_wal_row_skipped` | `Storage(CorruptRow)`; `Reopen` | later rows still replayed and delivered | S7:40 |
| `cached_seed_race` | `SeedDocument::Cached{s3, local}`; latencies make each seed win in turn (three variants) | exactly one `Seeded`; others `doc.seed outcome=discarded`; WAL replayed after any winner | S7:41, S7:42, S7:109 |
| `ttl_expires_orphans` | partition, type, `CrashProfile`, `AdvanceWall(8 days)`, reopen | `WalExpired{reason: TtlExpired}` and `EditDiscarded`; no push of expired rows | S7:25 |
| `revoked_writer_keeps_rows_until_regranted` | `Grant{Read}` mid-typing; then `Grant{Edit, force_reconnect}` | `AccessChanged(Read)`, `Unsaved(ReadOnly)`, rows delivered after regrant | S7:82, S7:80 |
| `poison_row_quarantined` | partition a; a types; `Crash{a}`; `Storage(CorruptRow)` on a's undelivered row; heal; `Reopen{a}` adopts and pushes the unimportable row while other traffic is acked | after 20 not-acked pushes a `PeerAssigned{Probe}` and a `RequestSnapshot`; `RowsParked{Poison}` (no `WalQuarantine` delete, row still in `StoreImage` with `quarantined`); then one `ResetStarted`; a's later edits are delivered under the new peer; status never `Saved` while parked; `quiet` holds | S7:122 |
| `d1_outage_never_quarantines` | a types steadily; `Server(D1Outage{ms: 300_000})`; `Settle` | no `RowsParked{Poison}`; `wal.delivery_outage{suspect: server}` opened; status `Unsaved(Undelivered)` throughout the outage; after it ends every edit is acked; `no_transient_quarantine` | S7:122 |
| `view_token_regrant_reconnects` | `Grant{Read, force_reconnect}` (the new connection is View); `Grant{Edit, force_reconnect: false}` | a closes its View connection with `Superseded` and reconnects; no push is sent on the View connection; rows delivered; no `RowsParked{Poison}` | S7:82 |
| `close_within_coalesce_window_keeps_edit` | `Type`; `Run(5)`; `Close{a}`; `Reopen{a}`; `Settle` | `Reply::Stopped` after the append's `WalDurable`; `no_edit_lost_without_crash` | S7:99, S7:2 |
| `offline_reopen_remote_seed_wins_rebases_once` | a offline types; `Crash{a}`; b edits the same paragraph; latencies make the remote seed win on `Reopen{a}` | exactly one `RebaseStarted`; no `ResetStarted`; a's offline text visible on a and b; `no_spurious_terminal` | S7:42, S7:16 |
| `reconnect_storm_no_terminal` | 4 clients online; 3 laptops go `Offline`, type, come back within 60 s | no `Closed(Corrupt)`; rebases ≤ 1 per client per 10 s; converge | S7:13, S7:16 |
| `two_tabs_no_echo` | a, b in one profile, both `Edit`; a types 200 keys | b stores a's bytes once as a foreign row, never posts them; `foreign_bytes_pushed / own_bytes_pushed ≤ 0.2`; `quiet` holds | S7:2, S7:122 |
| `read_only_tab_parks_nothing_foreign` | a `Edit`, b `Read` in one profile; a types | b stores no foreign row; b is `is_idle`; `settled` | S7:3 |
| `revoked_rows_parked_not_lost` | `Grant{Read}` mid-typing, no regrant; `Settle` | `RowsParked{ReadOnly}`; `settled` holds; rows still in `StoreImage` | S7:82 |
| `large_paste_multi_frame` | `PasteMarkdown` of the > 1 MB snippet; `Server(Hibernate)` between its frames | `PushSent` with one row and `Frame{frames > 1}` (a single entry over the cap is pushed alone as a multi-frame message; nothing splits it); converge | S7:76, S7:89 |
| `heartbeat_death_and_late_pong` | `DropNext{ToClient, Pong, 2}`; then `DropNext{ToClient, Pong, 3}` | first: `missed` recovers, no close; second: close at ~35 s, reconnect | S7:69, S7:70 |
| `connect_timeout_and_abandoned_socket` | partition during connect (connects black-hole, §1.2) | `SocketClose{ConnectTimeout}` at 15 s; after heal the late open is closed | S7:73, S7:75 |
| `reconnect_while_connect_pending` | `Host{Visible}` twice during `Authorizing` | one `FetchToken` only | S7:72 |
| `token_fallback_and_expiry` | `TokenFetchFail{n: 1}` with an initial token; `TokenExpire` | first reconnect uses `last_token`; expired token gets 401 then a fresh fetch | S7:78, S7:74 |
| `flush_reports_not_drained` | partition; type; `Flush` | `Reply::Flush(NotDrained{..})` at storage + ack timeout; after heal `Drained` | S7:96, S7:32 |
| `editor_error_stops_session` | `EditorError{a}` | a `Stop`s; presence cleared on peers | S7:99 |
| `init_strips_abandoned_drafts` | seed with a draft comment mark | one `FORCE_SYNC`-equivalent local commit; peers never see the mark | S7:98 |
| `selection_restored_after_remote_edit` | a selects; b types before a's cursor | a's selection is restored to the same logical point | S7:101 |
| `form_presence_refresh_and_publish` | `SurfaceKind::Form`; idle 10 s | presence re-sent every 3 s; `Status.save` reaches `Saved` | S7:104, S7:105 |
| `ai_worker_peer_hidden_and_flushes` | `ClientKind::AiWorker` edits and closes with a partition | `ai_peers_hidden`; `Flush` replies `NotDrained` while partitioned | S7:108, S7:113, S7:114 |
| `clock_skew_presence` | `ClockSkew{b, -6_000}` with markdown's 5 s timeout | b's presence is dropped by peers (the documented P-1 behaviour); no data invariant fails | S7:90 |
| `power_loss_window` | `CrashProfile{PowerLoss{window: 200}}` after typing | `WalWriteLost` for the window's rows; no invariant counts them | S7 R-6 |
| unit | IDB abort retry (SC-3 rollback retry) | `doc_sync_core` + vitest adapter test | S7:27 |
| unit | outage and TTL telemetry spans | `TelemetryRecord` assertions | S7:25, S7:33 |
| unit | pre-listener drop; URL-resolver generation guard; heartbeat on a closing socket | `ConnId` stale-event tests | S7:61, S7:64, S7:71 |
| unit | Tauri read error; traceparent | executor vitest | S7:77, S7:79 |
| unit | spreadsheet snapshot serialization across mounts | SC-2 conformance | S7:107 |

---

## 11. The proptest

```rust
// crates/sync_sim/tests/random_sessions.rs
use proptest::prelude::*;
use proptest::test_runner::{Config, FileFailurePersistence};
use sync_sim::{prelude::*, generate::{script_strategy, ScriptShape}, invariants::check_all};

proptest! {
    // Case count comes from proptest's own PROPTEST_CASES (default 256); no env reads here (CS-14).
    #![proptest_config(Config {
        max_shrink_iters: 8_192,
        failure_persistence: Some(Box::new(FileFailurePersistence::WithSource("regressions"))),
        ..Config::default()
    })]

    #[test]
    fn random_sessions_converge(seed in any::<u64>(), shape in script_strategy(ScriptShape::default())) {
        let (document, body) = shape;
        let mut script = body;
        script.push(Step::ReopenCrashed);
        script.push(Step::Settle);

        let config = SimConfig {
            seed,
            document,
            net: NetProfile::lossy(),
            storage: StorageProfile::realistic(),
            ..SimConfig::calm(seed)
        };

        let outcome = Sim::new(config.clone()).run(&script);

        if let Err(failures) = check_all(&outcome) {
            return Err(TestCaseError::fail(format!(
                "{failures:#?}\n\n{}\n\nlast events:\n{:#?}",
                outcome.story_source("regression"),
                outcome.events.iter().rev().take(50).collect::<Vec<_>>(),
            )));
        }

        if seed % 16 == 0 {
            let again = Sim::new(config).run(&script);
            prop_assert_eq!(outcome.trace_hash, again.trace_hash, "nondeterministic run; seed {}", seed);
        }
    }
}
```

`ScriptShape::default()`:

- the seed document is `Markdown("# Title\n\nfirst paragraph\n\n- item\n- item two\n")` in 95%
  of cases and `Corpus("large")` (the 500 KB gen-docs document) in 5%;
- 2–4 clients over 1–3 profiles (so multi-tab profiles occur), 0–1 `AiWorker` client, and
  occasional `SignIn` changes;
- 10% read-only and 10% comment-only clients;
- 20–200 steps;
- weights: `Edit` 50, `Run` 15, `Net` 10, `Crash`/`CrashProfile`/`Reopen` 6, `Host`/`Offline`/
  `Freeze`/`Thaw` 4, `Server` 4, `Storage` 3, `Grant`/`TokenExpire`/`TokenFetchFail` 3,
  `ClockSkew` 1 (|offset| ≤ timeout / 2 by default), `Flush` 1, `Close` 1, `AdvanceWall` 1,
  `EditorError` 1; `Server` draws include `D1Outage` and `StorageErrors`;
- right after an `Edit`, the generator emits `Close` (or `EditorError`) with probability 0.2,
  so terminal paths inside the coalesce window are common;
- one profile in four opens two `Edit` tabs of the same document;
- 2% of clients are `ClientBuild::Faulty`;
- `Run` durations are log-uniform between 1 ms and 60 s, so both the 25 ms coalesce window
  and the ~35 s heartbeat death (10 s interval, 5 s timeout, close on the third miss) are hit;
- `ScriptShape::forms()` swaps editor ops for `FormSet`/`FormMove`;
- `ScriptShape::routed()` uses `Routed` transport with two documents;
- `ScriptShape::mixed_versions()` draws `ClientBuild` from `{Current, Pinned(N-1),
  TypeScript}`.

---

## 12. CI tiers

| Tier | When | What | Budget |
| --- | --- | --- | --- |
| T0 | every PR touching `crates/client/doc_sync_core`, `crates/client/document_session*`, `crates/sync_protocol`, `crates/sync_server_core`, `crates/sync_server_sim`, `crates/sync_sim`, `lexical_loro`, `lexical_model` | all stories; `random_sessions_converge` at 256 cases ≤ 200 steps; `generator_coverage` at 500 seeds (floors relaxed ×0.5); determinism on every story; the gate parity test | ≤ 3 min |
| T1 | merge to main | 4,096 cases; forms and routed shapes; Pinned(N-1) client and server matrix (§7.3); hostile network 512 cases (safety invariants only, §1.2); client golden transcripts (§7.4.1) | ≤ 15 min |
| T2 | nightly | 100,000 cases at up to 2,000 steps; TypeScript peers (tab and AI worker); full `generator_coverage` (2,000 seeds); executor-trace conformance and the real-browser storage suite (§9.2); deployed-worker Miniflare runs (§7.4.2); quirk-hit report; failures auto-filed with story source | ≤ 2 h |
| T3 | before a release that changes `sync_protocol`, storage schema or WAL rules | T2 plus every pair of the last two releases, and N-1 TS bundle vs new bundle in one profile | manual trigger |
| bench | nightly | the S7 §7 typing budget: 10,000 keystrokes per doc size through `DocumentSession` natively and in wasm (node), plus a regression gate on per-keystroke µs and allocations; the sim's event count per keystroke must stay 1 handle call | — |

T0 runs in the existing Rust CI job (`cargo test -p sync_sim`). The rest are scheduled
workflows. None of them deploys anything. The web wiring (`apps/web/justfile`,
`apps/web/vite.base.ts`, `nix/tauri-desktop.nix`) is covered by S7 §4.6's `document-session`
CI filter, not by these tiers. The bench tier runs through the real wasm ABI in node (S7 §4.2)
and reports the worst main-thread `tick` at the 500 KB size (S7 S-1).

---

## 13. What S8 needs from siblings

- **S7:** `SyncCore::is_idle`, `busy()` and `parked()`, `SyncDoc::probe_import`, `Reply::Stopped`,
  `TokenEvent::Fetched.access`, `TelemetryRecord peer.assigned`, the `SyncDoc` lending design, the §1.6 `StorageOp`
  contract (SC-1..9), `StorageOpId` correlation, `Now` on every input, D-1..D-4,
  `AuthorizationState{can_comment}`, `AccessChanged`, foreign and assist rows, `PeerRange::Ai`,
  and telemetry events for `wal.expired` (mapped to `WalExpired`), `wal.poison`/`wal.gap`
  (mapped to `RowsParked`) and `doc.sync.rebase` (mapped to `RebaseStarted`/`Finished`).
- **S6 (`sync_server_core`, `sync_server_sim`):**
  - `SimRoom::step(now, ServerInput) -> StepResult` over synchronous `SimPorts`, with
    `GateMode::Held`, the busy-window latency report, and `FaultSchedule` crashes (S6 §2.6);
  - the port log as `sync_server_sim::Effect`s, tagged per callback;
  - `Clock` as the only time source, presence included (`sync_protocol::presence`);
  - the comment gate as a port (`CommentGate`); this crate supplies `InProcessCommentGate`
    (dev-only; production keeps the HTTP port in this pass, S6 R2);
  - `FaultSchedule` errors on `PeerDirectory` and `RoomStorage` for `D1Outage`/`StorageErrors`.
- **Gate parity test** (T0, in `sync_sim`): the lexical-service `/comment-only-change` test
  corpus (`services/lexical-service` gate tests, plus the adversarial corpus S4 builds) runs
  through both `InProcessCommentGate` and the lexical-service implementation; every verdict must
  match. Sim results about comment safety count for production only while this passes.
- **`lexical_loro` (S11):** a projection-to-JSON function for `projected_json`, plus
  `EditorState` from a `LoroDoc` for `server.editor_json`, and Loro-id lookup for
  `UndoApplied.removed` and cursor resolution in `PresenceSnapshot`.
- **`macro_document_model`:** `synced_json` (the `$.local` strip, S11 §1.2), markdown export, and the
  comment-only check behind `InProcessCommentGate`.

---

## R1 resolutions

Audit R1-C findings that touch this spec, then audit R1-D §E.

| Finding | Resolution |
| --- | --- |
| C-F1 (High) server core shape | Accepted. §1.4 rewritten: `SimRoom::step` over synchronous `SimPorts`, `now_or_never`, output gate, busy window, server crash; `LocalPool`/pending-future fallback deleted. §13 updated. |
| C-F2 (High) presence clock | Accepted via S6/S7; §6 item 2 explains why the hash guard can't see it; `presence_converged` added. |
| C-F3 (Medium) paths | Accepted. `crates/sync_sim`, `crates/sim_peer_protocol`, story and T0 paths changed. |
| C-F5 (Medium) two sets of fakes | Accepted. `MemSnapshotStore`/`MemOpLog`/`MemGrants` deleted; `SimPorts` reused; grants moved to the token minter and front door. |
| C-F6 (High) comment gate | Accepted. `InProcessCommentGate`, gate parity test (§13, T0), `Server(Gate(Error \| Timeout))`. |
| C-F7 (High) Loro determinism | Accepted. §6 item 2 restates D-4; TS peer seeds `crypto.getRandomValues` (§6 item 6, §7.2). |
| C-F12 (Medium) frozen tabs | Accepted. `Freeze`/`Thaw` steps, `assist` pushes, story `frozen_tab_rows_assisted`. |
| C-F14 (Critical) chatter hole | Accepted. `WalAppendIssued.foreign`, `no_dependency_stuck`, story `chatter_dependency_survives_writer_crash`, foreign-row floor. |
| C-F25/F29 (High/Medium) quirks | Accepted. `KnownServerQuirk`, `check_all`, `quirk_hits` (§1.4, §4.2); H9 and A4 leave the list with S6 PRs 5–6. |
| C-F31 (High) missing facts | Accepted. Events `AccessChanged`, `ClientSettled`, `CommentSent`/`CommentReplied`, `PeerAssigned`, `WalExpired`, `WalAppendIssued.foreign`; `ServerApplied.spans` and `persisted_vv` defined; invariants rewritten on them. |
| C-F32 (Medium) acks after durable | Accepted. Split into `core_acks_after_writes` (port log) and `gate_releases_after_durable` (self-check); `AckSent` at gate release. |
| C-F33 (Medium) stories and names | Accepted. Story 2 uses `MarkdownShortcut{Ix(2)}` and explains the single resend; every named type defined in §3; markdown helpers defined; `HostSignal::Offline` replaced by sim-only `Step::Offline`. Story 3's drop kind corrected to `RemoteUpdate` (the server→client frame). |
| C-F34 (Low) heartbeat, env read | Accepted. ~35 s; `cases()` deleted, `PROPTEST_CASES` used. |
| C-F35 (High) missing faults | Accepted: `Server(Crash)`, `ClockSkew`, `TokenExpire`, `TokenFetchFail`, `SurfaceRevoke`, `FreezeSource`, `AiWorker` kind, gate faults, the S6-landed note (§7), `PowerLoss`, `Hibernate`, `HttpUpdate`, `ExistsProbe`, `FailLoad`, `CorruptSnapshot`, `Freeze`. Router: `SimRouter` protocol fake, because `sync_router`'s domain router uses tokio; `extra_documents` for ≥ 2 docs. The same-millisecond presence burst is covered by `TieMode::Perturb` plus `presence_converged` (loro's known same-ms drop then shows up as a failure to fix, not an allowlisted one). |
| C-F36 (Medium) `Grant` meaning | Accepted. `Grant{client, access, force_reconnect}` as specified. |
| C-F37 (Medium) settle undefined states | Accepted. §2.3: `None` transport idle, terminal clients excluded and reported, `SettleTimedOut` reasons. |
| C-F38 (Low) TS peer fidelity | Accepted. §7.2 states it is the ai-editing-worker binding. |
| D-E1 (High) presence | Accepted. `presence_converged`, `presence_expires`, `PresenceSnapshot`, `PresenceChanged`. |
| D-E2 (High) collaborative undo | Accepted. `UndoApplied`, `undo_reverts_only_own`, story `undo_reverts_only_the_undoing_users_edit`, undo floor. |
| D-E3 (High) corruption | Accepted. `Net(CorruptNext)`, `Storage(CorruptSnapshot \| CorruptRow)`, `Server(CorruptSnapshot)`, `ClientBuild::Faulty`; one story per row (§10.2); the reset floor now names its sources. |
| D-E4 (Medium) large payloads | Accepted. `Corpus("large")` in 5%, > 1 MB paste snippet, multi-frame floor, `large_paste_multi_frame`. |
| D-E5 (High) wire compatibility | Accepted. §7.4: client golden transcripts (T1) and the deployed-tag worker in Miniflare (T2). |
| D-E6 (Medium) fake-only conformance | Accepted. §9.2 real-browser SC suite and crash-adoption story in Playwright Chromium and WebKit. |
| D-E7 (Medium) uncovered S7 rows | Accepted. `Step::Flush`, `Step::EditorError`, `SeedDocument::Cached`; §10.2 maps every listed row to a story or a unit test. |

## R1 consistency pass

Checked every `lexical_model` reference against S1 Revision R1 (the source of truth):

- §2.2 `AbstractOp::Format` takes `TextFormatType` (one format; S1's `TextFormat` is the bit set).
- §2.2: `resolve` returns S1's `Point::Text`; added how each op lowers to `lexical_model::Input` /
  `Command` (S1 §14.1, §15), including the Headless rule (`ViewSelection::KeepModel` in the
  `selection` field, so AiWorker clients batch a `SelectionFromView` first) and Undo/Redo going to
  S7's Loro undo.
- §7.3: mixed-version runs rely on the D-23 ruling (`opaque_unknown_types(true)` in every session
  editor); an `UnknownSerializedType` there is a finding.

## R2 resolutions

Revision: R2. Audit R2-3 Part F (F19–F24) and the S8 parts of F1–F5.

| Finding | Resolution |
| --- | --- |
| F1 (S8 part) transient quarantine | Accepted. `Server(D1Outage{ms})`, `Server(StorageErrors{n})`; invariant `no_transient_quarantine`; `poison_row_quarantined` rewritten (probe, parking, forced reset, never `Saved`); new `d1_outage_never_quarantines`, `view_token_regrant_reconnects`. `DiscardReason::Poison` removed; poison is `RowsParked{Poison}`. |
| F2 (S8 part) close in window | Accepted. `Close` waits for `Reply::Stopped`; story `close_within_coalesce_window_keeps_edit`; generator emits `Close`/`EditorError` after `Edit` with p = 0.2; floor. |
| F3 (S8 part) reset storms | Accepted. `no_spurious_terminal`; `RunStats.rebases` and a ≥ 10% floor; `RebaseStarted`/`Finished`; stories `offline_reopen_remote_seed_wins_rebases_once`, `reconnect_storm_no_terminal`. |
| F4 (S8 part) echo | Accepted. `PushSent.{foreign_bytes, own_bytes}`, ratio ≤ 0.2 in calm runs, ≥ 2-Edit-tab floor, `two_tabs_no_echo`, `read_only_tab_parks_nothing_foreign`. |
| F5 (S8 part) parked rows | Accepted. Quiescence uses S7's parked-aware `is_idle`; `RowsParked`; `all_wals_drained`/`no_edit_lost_without_crash` exemptions; `status_truthful` tightened; `revoked_rows_parked_not_lost`. |
| F19 Backspace deletes nothing | Accepted. Lowered to `ModifyTarget::ModelSegmentation` (feature `model-segmentation`); floor ≥ 90% of Backspaces create spans. |
| F20 connect timeout vs partition | Accepted. Partitions black-hole connects indefinitely; the `4×` fast failure is `Step::Offline` only; story text fixed. |
| F21 uncomputable joins | Accepted. `PushSent.rows: Vec<(WalOwner, WalSeq)>`; `WalAdopted.map`; `Event::LocalCommit{cause}`; `comment_replies_truthful` exempts `NotAcked`, `CommentSent.mark_id`; `Opened.{access, doc}`; `PeerAssigned` from S7 `peer.assigned`; `presence_converged` grouped by `DocIx`. |
| F22 hostile vs FIFO | Accepted. `Hostile` reorders only across connections, duplicates idempotent messages, drops frames only with S7's `ProtocolError` close; safety invariants only. |
| F23 story metadata | Accepted. Story 1 `covers: S7:36, S7:25`; `large_paste_multi_frame` asserts one row and `frames > 1`; story 3's note updated for coalesced presence. |
| F24 generator and stats gaps | Accepted. §9.1 stats and floors for D1/storage faults, close-in-window, rebases, two Edit tabs, parked rows, late commits after lock release. |
| R2-4 M7 CI filter | Pointer added (§12): S7 §4.6 owns the web-wiring filter. |

## R2.1 consistency

Part B of the final pass (S1 R2.1's list for S8, S11 §10 Q3).

| Item | Change |
| --- | --- |
| S1: sim editors | §7.3: built with `EditorBuilder::view_host` (no `CoreConfig.platform`); `EditorCore::take_initial_output` drained and projected before the first step |
| S11 Q3 `sharedPeerIds` | §4.1 `editor_states_equal`: `synced_json` strips `$.local`, not `sharedPeersState`. Today's TS stack syncs every `$` key (`loroSyncState`, open `$` map in `markdown-loro-schema.ts`), so `sharedPeerIds` is synced co-ownership and must compare equal across peers. The stray `local-status` (a tag, not state) is restated as the `$.local` it writes |
