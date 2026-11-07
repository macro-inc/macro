# sync_sim

## What it is

Dev-only deterministic synchronization world: real `doc_sync_core::SyncCore`
clients and real `sync_server_core::Room` callbacks over `sync_server_sim` ports.

## Start here

- `src/world.rs`: virtual event executor and script transitions.
- `src/storage.rs`: durable profile storage and lease/adoption rules.
- `src/network.rs`: FIFO links and injected failures.
- `src/invariants.rs`: queries over the immutable Outcome facts.

## Boundaries

- One thread, one virtual clock, one seeded ChaCha8 RNG. No ambient clocks,
  sleeps, environment reads, threads or random identity generation.
- Run real cores; never infer server outputs from expected outcomes.
- GenericSurface/Loro clients are available before editor/session siblings.
  Editor projection, undo and comment-gate parity remain pending integration;
  never claim a skipped editor check establishes an editor safety property.
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
