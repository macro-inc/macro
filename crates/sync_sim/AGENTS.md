# sync_sim

## What it is

Dev-only deterministic synchronization world: real `doc_sync_core::SyncCore`
clients and real `sync_server_core::Room` callbacks over `sync_server_sim` ports.

## Start here

- `src/world.rs`: virtual event executor and script transitions.
- `src/storage.rs`: durable profile storage and lease/adoption rules.
- `src/network.rs`: FIFO links and injected failures.
- `src/router.rs`: bounded server router protocol fake; `src/world/router.rs` wires
  real client RouterCore instances to physical profile sockets and real room routes.
- `src/invariants.rs`: queries over the immutable Outcome facts.

## Boundaries

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
- All storage completion events mean durable; tab death keeps issued writes,
  process death loses pending writes, power loss additionally rolls back recent writes.
- Settlement reopens gracefully stopped clients to drain retained WAL; Stop itself
  still waits only for durable local writes. Crashed clients require explicit reopen.
- H9/A4 have been fixed: never allowlist either data-loss behavior.
- Keep excluded from hakari; no deployable artifact depends on this crate.

## Checks

- `cargo test -p sync_sim`
- `cargo clippy -p sync_sim --all-targets -- -D warnings`
- `just check`, `cargo x deps --check`
- Same seed/script must yield byte-identical canonical event logs.
- Re-record the Worker suite and require zero normalized transcript differences.
