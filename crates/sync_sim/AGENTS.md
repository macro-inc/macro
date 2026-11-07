# sync_sim

## What it is

Dev-only deterministic synchronization world: real `doc_sync_core::SyncCore`
clients and real `sync_server_core::Room` callbacks over `sync_server_sim` ports.

## Start here

- `src/world.rs`: virtual event executor and script transitions.
- `src/storage.rs`: durable profile storage and lease/adoption rules.
- `src/storage_reference.rs`: independent flat-row IndexedDbModel and portable StorageCase/StorageContract suite.
- `src/network.rs`: FIFO links and injected failures.
- `src/router.rs`: bounded server router protocol fake; `src/world/router.rs` wires
  real client RouterCore instances to physical profile sockets and real room routes.
- `src/defaults.rs`: host-supplied production session policies.
- `src/replay.rs`: exact replay and first-differing-event/port/final diagnostics.
- `src/invariants.rs`: queries over the immutable Outcome facts.

## Boundaries

- Configure client/physical-router policies through SimConfig.session; preserve the
  AI-worker direct/fixed-key/two-second-refresh behavior. None transport can settle
  without a physical connection. Presence queries use the configured timeout.
- One thread, one virtual clock, one seeded ChaCha8 RNG. No ambient clocks,
  sleeps, environment reads, threads or random identity generation.
- Run real cores; never infer server outputs from expected outcomes.
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
- GenericSurface/Loro clients are available before editor/session siblings.
  Editor projection, undo and comment-gate parity remain pending integration;
  never claim a skipped editor check establishes an editor safety property.
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
- Same seed/script must yield byte-identical canonical event logs.
- `SIM_SEED=197 cargo test -p sync_sim --test replay -- --nocapture` runs the
  explicit replay story; only this CLI test host reads SIM_SEED. Use Outcome::replay
  for an arbitrary stored script and compare_replay for first-difference evidence.
- Re-record the Worker suite and require zero normalized transcript differences.
