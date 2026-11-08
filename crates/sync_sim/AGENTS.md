# sync_sim

## What it is

Dev-only deterministic synchronization world: real `doc_sync_core::SyncCore`
clients and real `sync_server_core::Room` callbacks over `sync_server_sim` ports.

## Start here

- `src/client/application.rs`: real application registries, policy and injected constructor ports.
- `src/client/rich_commands.rs`: package block/table operations; list commands use the registered list plugin.
- `src/client/runtime.rs`: exclusive generic/session ownership; `src/client/resolve.rs`: live UTF-16 positions.
- `src/world/editor.rs`: real session editor inputs and effects; `editor/input.rs`
  lowers range edits and segmented backspace without resetting consecutive cursors.
- `src/world.rs`: virtual event executor; `src/world/settle.rs`: healing and quiescence.
- `src/storage.rs`: durable profile storage and lease/adoption rules.
- `src/storage_reference.rs`: independent flat-row IndexedDbModel and portable StorageCase/StorageContract suite.
- `src/network.rs`: FIFO links and injected failures.
- `src/router.rs`: bounded server router protocol fake; `src/world/router.rs` wires
  real client RouterCore instances to physical profile sockets and real room routes.
- `src/defaults.rs`: host-supplied production session policies.
- `src/replay.rs`: exact replay and first-differing-event/port/final diagnostics.
- `src/source.rs`: complete literal Rust reproductions, including every policy clock.
- `src/generate.rs` + `src/generate/`: abstract action strategies, explicit causal scenarios
  and literal workload materialization; positions resolve only in the real world.
- `tests/random_sessions.rs` and `.regressions*`: standard proptest shrinking/persistence.
- `src/generate/test.rs`: literal minimized revoked memory-writer recovery draw; keep every invariant and replay check enabled.
- `tests/generator_coverage.rs`: all500 observed runs on four isolated host workers.
- `src/world/external.rs`: pure ports for caller-owned TS drivers, no shadow SyncCore.
- `tests/stories/COVERAGE.md`: GenericSurface story/S7 map and pending editor producers.
- `src/stats.rs`: fact-derived coverage counters; runtime counters retain actual queue/handle timing.
- `src/invariants.rs`: queries over the immutable Outcome facts.

## Boundaries

- Configure client/physical-router policies through SimConfig.session; preserve the
  AI-worker direct/fixed-key/two-second-refresh behavior. None transport can settle
  without a physical connection. Presence queries use the configured timeout.
- One thread, one virtual clock, one seeded ChaCha8 RNG. No ambient clocks,
  sleeps, environment reads, threads or random identity generation.
- Run real cores; never infer server outputs from expected outcomes.
- The direct SimDoc host accepts already-staged comment updates; a `CommentReady`
  event requires the document_session host and fails loudly here.
- Apply `Room::gate_request` before legacy connect/atomic handlers. Record
  `HttpPrepared` as core response preparation, distinct from a durable HTTP ack.
  Forward only successful runtime close requests and preserve their actual code.
- Configure true surface rooms with `SimConfig.surfaces`; initialize through the
  surface lifecycle, mint expiring surface grants, and preserve permanent revocation
  across eviction. GenericSurface form content alone does not imply surface identity.
- Keep `Hostile` message delays/duplication FIFO within each connection; run S8's
  named safety subset and observe real close causes (`ProtocolError` maps to 1000).
- Build cached seed versions from one Loro history; install profile-local cache
  once per profile/document and observe real `Seeded` events. The core defers a
  remote seed while local load is pending; never bypass that arbitration.
- Editor seeds create real DocumentSession<EditorSurface> clients; generic seeds
  retain the real lending SyncCore host. A session exclusively owns its editor,
  projection, undo and document; never keep a shadow core or mutable document copy.
- Capture live synced editor JSON and independently reconstructed persisted JSON.
  Compare both per step and in finals; include editor finals in replay/hash evidence.
  Remaining M2 command/story and comment-gate producers are listed in COVERAGE.md.
- Headless inputs always use KeepModel. Install resolved selection through the
  registered model-selection-only command, then dispatch the actual command in
  the same core Batch. SelectionFromView(Range) is rejected in headless mode even
  inside Batch; never bypass that guard or invent Edit authority.
- Preserve desired front-door grants across old-connection AccessChanged events;
  track effective access separately in finals and coverage. Admit document edits only
  with actual effective Edit access; a desired grant does not change a fixed host capability.
- Use immutable issued token claims through delayed dials. Send RouterSubscribed
  before upstream frames, record the connect callback before pumping queued inputs,
  and discard stale socket generations and route epochs. Router parity uses real
  sync_router domain stories plus its production envelope helpers/cancellation contract;
  Tokio is a test-only dependency, never the virtual world executor.
- Pass the requesting session’s skewed wall time and configured WAL retention into
  storage loads; retain its issued offset across tab death/reopen. Other-user
  unexpired/leased rows stay hidden; expired orphan metadata has no payload. Cache
  eviction refuses undelivered rows; explicit corrupt-snapshot deletion is separate.
- Register callback durability before forwarding outputs that can invoke nested callbacks.
- All storage completion events mean durable; tab death keeps issued writes,
  process death loses pending writes, power loss additionally rolls back recent writes.
- Validate real own-push diagnostics against a contiguous eligible WAL run,64 rows
  and256KiB (one oversized row is sent alone). Prefix checks include Some-to-None
  regressions and absent owners; exempt only completed prune/adoption or actually
  rolled-back delivery rows, never an entire power-loss profile.
- Settlement waits for queued non-periodic inputs, network frames and controls before
  its heartbeat hold; only periodic awareness, ping/pong, wake and alarm work is ignored.
  Core idleness and durable callback counters still cover outstanding operations.
  Complete already-issued token failures before the healing Online signal. Capture
  the first presence view of each stable lifetime after finite upstream/downstream
  FIFO publication barriers;
  ignore later refreshes and restart the barriers for new socket/route lifetimes.
  Include writer peer/key replacement in publication lifetimes and reissue the
  actual current selection even when periodic refresh is disabled. Keep bounded
  backward clock offsets and wait for publication time to catch up. Before that
  first resend, allow retired keys their fixed TTL plus observed signed clock
  spread, maximum issued latency and one millisecond; never wait for query success.
  Once data work and old publications drain, issue one fresh selection and finite
  FIFO barrier pair so bounded skew cannot expire the entry-time publication
  before the first view. Heartbeat restarts alone do not replace that view. At preliminary idle, also
  deliver a real Visible rescan and drain its adoption/snapshot effects before
  capture. Repeat after observed completed durable writes change the selection;
  reset the candidate hold, retaining deadline/event limits. The current rollback
  history's write count is a watermark only during healed Settle, which performs
  no rollback or truncation. Never consult invariant results to trigger a rescan;
  quiet still compares exact final storage metadata.
- Record actual partition/offline losses on exact open socket generations, including
  packets lost at delivery. Preserve evidence across explicit Heal. During Settle,
  close only affected generations still open through real direct/router callbacks;
  never reconnect a newer generation, lost-ACK socket, or fault with no lost traffic.
- Settlement reopens gracefully stopped clients to drain retained WAL; Stop itself
  still waits only for durable local writes. Crashed clients require explicit reopen.
- Settlement thaws injected source freezes through the real migration operation and
  its durable receipt, including after room eviction; never clear persisted gates directly.
- H9/A4 have been fixed: never allowlist either data-loss behavior.
- Keep excluded from hakari; no deployable artifact depends on this crate.

## Checks

- `cargo test -p sync_sim` (includes reusable transaction reference comparisons, FIFO,
  completion/crash, uncertain retry, no-wipe, namespace isolation and lease-order contracts).
  Real browser database identity/async Web Lock conformance belongs to S8 §9.2.
- `cargo clippy -p sync_sim --all-targets -- -D warnings`
- `just check`, `cargo x deps --check`
- Count reached paths from completed facts; requested faults alone cannot satisfy a
  generator coverage floor. Preserve actual fragment counts across network delivery.
- Same seed/script must yield byte-identical canonical event logs. Borrow sorted
  JSON during trace serialization and read per-step core diagnostics directly;
  preserve exact event/port bytes, hash encoding and invariant predicates.
  Deserialize recorded server frames and pending payloads from borrowed JSON;
  return owned byte vectors without cloning intermediate JSON arrays.
- `SIM_SEED=197 cargo test -p sync_sim --test replay -- --nocapture` runs the
  explicit replay story; only this CLI test host reads SIM_SEED. Use Outcome::replay
  for an arbitrary stored script and compare_replay for first-difference evidence.
- Re-record the Worker suite and require zero normalized transcript differences.

Count actual telemetry span starts separately from scheduling point events. Observe
successful snapshot deletion, token requests and exact fault-damaged WAL identities.
Only exempt an actually corrupted row from persisted-edit loss while an exact adoption
alias remains quarantined/unacknowledged; ACK loss checks remain strict. Above a
parked gap, count exact live-owner ACK evidence without inventing a durable prefix.
Read replicas may retain extra private history, but must dominate server VV; equal
VVs still require equal content. Keep failed accepted socket halves until their real
close callback completes, then remove runtime membership. Cancel obsolete directory
heal timers when faults are explicitly healed.

Mixed TS driver setup, generated IPC, fidelity limits and checks are documented in
[`tooling/sync-sim/AGENTS.md`](../../tooling/sync-sim/AGENTS.md). Native Outcome replay
rejects foreign-driver runs without the caller's complete command/report transcript.

Browser WAL recovery opportunities require a durable Tab in the exact settled
session. AiWorker uses memory persistence, so it cannot drain a browser profile's
StoreImage; its own live WAL and every acknowledged edit remain checked strictly.
Power-loss exemptions require the exact emitted WalWriteLost row/adoption alias,
including a previously stopped tab; never exempt a whole crashed profile.

Presence expiry obligations use the live receiver's Opened epoch at the source
fault. A receiver already crashed cannot tick, and a later reopen must not inherit
its previous incarnation's last view; live and thawed receiver deadlines stay strict.

Join retained read-only parking through exact owner sessions, including an old user
whose client name has reopened. Require retained rows and final parking/access in
that epoch; never forgive missing rows. Exempt an exact live read-only owner's parked
row from the profile-drain check, while keeping durable recovery and ACK checks strict.
Comment-only replicas share Read's private-history rule and must cover server history.

Observe exact per-row core delivery and checksum-valid parked intervals in finals.
Above a parked gap, require both live-owner delivery and cold persisted-VV coverage
before treating a retained StoreImage row as confirmed. Actual Gap rows stay parked;
missing durable edits still fail independent loss queries. A live revoked memory AI
can retain its own ReadOnly WAL without a browser append fact; require its exact
validated retained intervals and parking, never infer retention from document VV.

Record only applied clock-skew transitions as facts. Expiry uses timeout plus
observed signed offset spread (including baseline zero) and latency: opposite
sender/receiver offsets add. Keep deadline checks and exact stale-view mutations;
unapplied script intentions cannot extend the budget or exempt convergence.

WP-50 generator hosts use proptest's standard Config (including its environment
configuration) outside the environment-free Sim executor. Default cases are256;
PROPTEST_CASES controls the total across four independent host runners (quotient +
remainder, asserted exact). Fixed master seeds derive distinct printed shard seeds;
random defaults stay random. Shard0 retains the committed regression file; other
shards use separate persistence suffixes. Shrinking deletes abstract actions and reduces
numbers, and failures print complete literal input plus actual observations. Keep
max_shrink_iters8192 and sampled exact replay; the CLI alone reads SIM_SEED.
The random-sessions binary includes coverage exactly once, allowing libtest to run
both hosts concurrently. Explicit Cargo test targets retain replay, stories and
mixed_versions. Filter coverage with `cargo test -p sync_sim --test random_sessions
coverage::generator_coverage -- --nocapture`.
Coverage runs every seed0..500/allqueries on four independent host threads, each
owning one single-threaded world. A host-only atomic seed queue balances heavy
cases; aggregate by seed and assert every seed was executed exactly once. Count completed paths,
not requested faults; retain all GenericSurface half-floors and skipped ratio<=15%.

Generate account changes only for profiles whose existing desired and fixed host
capabilities permit old-user Edit drainage. Reopen crashed sessions and Settle
already-issued immutable claims, then explicitly
refresh those profile connections under the same grant, Settle again, and execute
AssertProfileDrained before the sampled CrashProfile/SignIn. The assertion checks
actual current-user retained rows without mutation. Never invent Edit authority.
Undrained/read-only old-user switches remain isolation-only, outside generated
convergence claims: a new writable user's cache can otherwise depend on a private
old-user parent that cannot upload. Keep the retained-row isolation stories and
counterexample report; do not claim broader cached-account convergence.

For final T0 acceptance run `PROPTEST_CASES=256 cargo test -p sync_sim`, including
all stories, the500-seed coverage and shipping TS peer. Measure total wall time
and peak memory; standalone coverage timing is not the three-minute suite claim.

Native adoption and the independent transaction reference reject stale loaded
snapshot covers and changed exact row selections atomically, including concurrent
partial TTL deletion and selection growth/shrink. The expected records are part of
the Rust storage operation; the server wire protocol is unchanged.
The pure client retries a real load before reserving a new selection. This Rust
storage port is distinct from the shipping TS peer's BrowserWAL API.

Rollback history shares only equal immutable row/snapshot leaves under the same
keys. Preserve every checkpoint/timestamp/append marker and every power-loss cutoff
and emitted fact. Public images/reads stay owned; restore the oldest popped image
once after computing the same rollback sequence. Compare with the original owned
history algorithm across mixed writes, adoption, TTL, corruption and snapshot changes.

The workspace test profile optimizes xxhash byte hashing, measured in real cold
snapshot checksum validation and exact trace hashing. Debug assertions and
overflow checks stay enabled; production profiles and hash algorithms do not
change. Prebuild before timing a warm T0 run and retain all256 shrinking cases,
500 coverage seeds, every story/peer and every invariant.

Record UndoApplied only when the real Loro UndoManager reports a change. Capture
actual visible text-character and editor-node creation IDs immediately before and
after undo/redo, before projection fixups; never infer removals from new operation
spans or requested inputs. Keep ownership checks over both undo and redo, including
foreign-removal negative mutations and a no-op-history control.

Editor runtimes use the source application headless/MarkdownSync registries,
MacroSyncPolicy and source NodeIdPlugin lengths (web8; AI default11). Supply constructor
time from each actual Now before handling input. Seed deterministic constructor
and transactional identity streams by peer and factory creation ordinal, so a
rebuild cannot restart a retired identity stream. Keep the staging comment factory
matched to CommentNode. This registry checkpoint does not establish application
comment-gate parity; the gate remains a separate required producer.
