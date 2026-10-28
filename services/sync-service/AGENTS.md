# sync-service

## What it is

Powers real-time collaboration on Documents and other collab surfaces
(spreadsheets, forms): a Cloudflare Worker (Rust compiled to wasm) hosting
one Durable Object per collaborative document ("room"), syncing Loro CRDT
updates over WebSocket.

## Start here

- `README.md`: project structure, Durable Object lifecycle (in-memory vs
  persistent state, the keep-alive alarm), JWT auth, and Bebop codegen. Read
  it before changing this service.
- `src/durable_object.rs` + `src/durable_object/document_api.rs`: the Durable
  Object — WebSocket handling, loro document state, alarm-driven snapshotting.
- `src/durable_object/surface_api.rs`, `surface_migration.rs`: non-document
  surfaces (spreadsheets, forms, etc.) hosted the same way.
- `src/storage/` + `src/storage/backends/`: snapshot/op-log persistence,
  pluggable across D1/KV/R2/combined backends (see the Cargo feature flags).
- `src/auth.rs`: JWT verification against tokens minted by
  `document_storage_service`.
- `build.rs` + `bebop-schema/`, `bebop/`: Bebop wire schema and codegen for
  Rust and TypeScript bindings.

## Scope

- Owns: real-time sync of Loro documents over WebSocket, snapshot
  persistence, and the sync-service's own auth/permission checks on
  established connections.
- Not here: minting the document-access JWT → `document_storage_service`;
  document domain logic → the owning domain crate (e.g. `collab_surface`).

## Recipes

- Change the wire protocol: `bebop/schema.bop` → `cd bebop && npx bebop-tools build`
  (TS bindings) → `worker-build` regenerates Rust bindings via `build.rs`.
- Add a storage backend: `src/storage/backends/` (new file + `mod.rs`) → gate
  it behind a new feature in `Cargo.toml` → wire into `src/storage.rs`.
- Add a non-document surface: `src/durable_object/surface_api.rs` →
  `src/domain/` (surface-specific logic) → migration in
  `src/durable_object/surface_migration.rs` if it changes stored shape.

Active-peer queries with `include_ai=false` exclude signed agent actors and the
legacy reserved AI peer range; Canvas workers use random full-width peer IDs.

## Checks

- `just test` (runs `worker-build`, then `npx vitest run` and `cargo test`)
  from this directory.
- `just test-no-alarm` to verify core logic without `alarm-keep-alive`.
- Use Node.js 22.12+/24.x/26+ for Vitest 5; install JS deps with `npm ci`
  (`package-lock.json` is authoritative, not `bun.lock`).

## Gotchas

- Bumping `loro-crdt` touches three lockfiles: `bun.lock`, the workspace
  `Cargo.lock`, and this directory's `package-lock.json` — update all three.
- Durable Object in-memory state (including the loro document) evicts after
  10s of inactivity even with open connections; the alarm-based heartbeat in
  `src/keepalive.rs` is what keeps it warm, not WebSocket traffic.
- The Durable Object handles one request or WebSocket message at a time
  (`mutation_barrier` in `src/durable_object.rs`). Keep per-update work
  proportional to the update; `LoroDoc::diff`, `fork`, and checkouts cost time
  that grows with document history. A backlog past `DEFAULT_TIMEOUT_MS` (4.5 s)
  makes the front worker fail connects, which clients see as close 1006.
- `migration-test-hooks` is test-only fault injection — never enable it in a
  deployed worker (see the feature's doc comment in `Cargo.toml`).
- Never run `just deploy-dev` / `just deploy-prod` without explicit approval.

## Related

- Docs: this directory's `README.md`

- Room `/exists` checks the durable snapshot, not the document ID set by a
  connection. To regress connect-before-initialize, build without
  `create-default-state` and run `SYNC_TEST_UNINITIALIZED_ROOMS=true npx vitest run
  tests/canvas_initialization.test.ts`; the usual test build seeds automatically.
