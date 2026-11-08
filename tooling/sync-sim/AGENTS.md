# sync-sim TS peer

## What it is

Test-only Bun host for the shipping collaboration SyncEngine, BrowserWALStore,
WALSyncer and LoroManager GenericMirror, plus the actual AI EditingWorkspace
for editor peers. Rust owns the same real SimServer used
by native clients. No shipped package depends on this directory.

## Start here

- `runtime.ts`: install deterministic clock/entropy and block fetch before imports.
- `transport.ts`: WebSocket byte port below the shipping socket/framing stack.
- `peer.ts`: real engine, WAL and GenericMirror integration.
- `editor-peer.ts`: shipping AI workspace, editor bindings and rotating peer commits.
- `editor-ops.ts`: live upstream positions and package editing operations.
- `storage.ts`: actual storage observations shared by both hosts.
- `ts-peer.ts`: JSON-lines command/report adapter; stdout is protocol only.
- `../../crates/sync_sim/tests/mixed_versions.rs`: native host and assertions.

## Boundaries

- Keep IPC types generated from `tests/support/peer_protocol.rs` with Specta:
  `cargo run -p sync_sim --example export_peer_types > tooling/sync-sim/generated.ts`.
- Keep the branch catalog's Loro pin; upgrades belong to their own stack.
- Install fake timers and seeded entropy before importing shipping modules.
  Keep fetch blocked; do not initialize observability exporters.
- Await issued storage work and the event-loop barrier; never await a future
  network ACK while the Rust host is waiting for a command report.
- T0 uses direct connections opened only while Room ingress is idle. Unexpected
  server closes fail explicitly; router/fault/reconnect lifecycle is native-only.
- WAL handoffs copy actually observed committed rows into the receiving adapter.
  They do not establish shared browser ABI, database identity or async Web Lock parity.
  Legacy rows have no user identity and are attributed to the importing current user
  per S7 O-2; these handoffs do not establish mixed-account cache convergence.
- Editor peers use the actual AI worker registry, bindings, engine and WAL. Reject
  undo/redo and browser movement commands absent from that shipping workspace;
  native DocumentSession stories exercise those paths. Do not emulate a binding.
- Record local-update ranges from decoded subscription bytes, including rotated AI
  peers, before forwarding frames. Imported VV growth is not authorship evidence.
- Await stdout completion before shutdown; table snapshots can exceed a pipe buffer.
- Seed Node random-fill and Node webcrypto as well as global crypto before importing
  either shipped Nanoid version.
- GenericMirror tests alone do not establish editor or browser-selection parity.

## Checks

- `bun run --cwd tooling/sync-sim typecheck`
- `bun run --cwd tooling/sync-sim check` (generated output excluded; Rust drift test checks it exactly).
- `cargo test -p sync_sim --test mixed_versions`
- Compare actual TS content/VV and WAL metadata; replay the complete IPC transcript
  and raw Room ports exactly, not only native final states.
