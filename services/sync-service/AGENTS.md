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
- `src/inbound/durable_object.rs` + `src/inbound/durable_object/document_api.rs`: the Durable
  Object — WebSocket handling, loro document state, alarm-driven snapshotting.
- `src/inbound/durable_object/surface_api.rs`, `surface_migration.rs`: non-document
  surfaces (spreadsheets, forms, etc.) hosted the same way.
- `src/outbound/storage/` + `src/outbound/storage/backends/`: snapshot/op-log persistence,
  pluggable across D1/KV/R2/combined backends (see the Cargo feature flags).
- `src/inbound/auth.rs` + `src/inbound/credentials.rs`: route-specific access
  extractors and JWT verification against tokens minted by
  `document_storage_service`.
- `build.rs` + `bebop-schema/`, `bebop/`: Bebop wire schema and codegen for
  Rust and TypeScript bindings.

- `src/inbound/router.rs` + `src/inbound/worker.rs`: Axum document/surface
  routing and worker proxy/copy orchestration.
- `src/domain/permissions.rs` + `src/domain/document.rs`: session permission
  policy and content-agnostic atomic update use cases.

## Scope

- Owns: real-time sync of Loro documents over WebSocket, snapshot
  persistence, and the sync-service's own auth/permission checks on
  established connections.
- Not here: minting the document-access JWT → `document_storage_service`;
  document domain logic → the owning domain crate (e.g. `collab_surface`).

## Recipes

- Change the wire protocol: `bebop/schema.bop` → `cd bebop && npx bebop-tools build`
  (TS bindings) → `worker-build` regenerates Rust bindings via `build.rs`.
- Add a storage backend: `src/outbound/storage/backends/` (new file + `mod.rs`) → gate
  it behind a new feature in `Cargo.toml` → wire into `src/outbound/storage.rs`.
- Add a non-document surface: `src/inbound/durable_object/surface_api.rs` →
  `src/domain/` (surface-specific logic) → migration in
  `src/inbound/durable_object/surface_migration.rs` if it changes stored shape.

Active-peer queries with `include_ai=false` exclude signed agent actors and the
reserved AI peer blocks (`ai_peer.rs`); Canvas workers use random full-width
peer IDs. `peer_user_map` records each peer's user and agent actor; history and
blame attribute edits from it, so never reuse an AI peer id.

Document read/write/debug handlers declare their minimum session grant through
Axum extractors; atomic reads/updates require a signed document grant even when
an internal key is present. Surface grants remain kind-discriminated and exact
to the requested surface. These are scoped sync JWTs, not app-session tokens.

## Checks

- `just test` (runs `worker-build`, then `npx vitest run` and `cargo test`)
  from this directory.
- `just test-no-alarm` to verify the legacy feature selection; alarms now run
  regardless of the retained `alarm-keep-alive` compatibility flag.
- Use Node.js 22.12+/24.x/26+ for Vitest 5; install JS deps with `npm ci`
  (`package-lock.json` is authoritative, not `bun.lock`).

## Gotchas

- Bumping `loro-crdt` touches three lockfiles: `bun.lock`, the workspace
  `Cargo.lock`, and this directory's `package-lock.json` — update all three.
- Durable Object in-memory state (including the loro document) evicts after
  10s of inactivity even with open connections; the alarm-based heartbeat in
  `src/keepalive.rs` is what keeps it warm, not WebSocket traffic.
- The Durable Object handles one request or WebSocket message at a time
  (`mutation_barrier` in `src/inbound/durable_object.rs`). Keep per-update work
  proportional to the update; `LoroDoc::diff`, `fork`, and checkouts cost time
  that grows with document history. A backlog past `DEFAULT_TIMEOUT_MS` (4.5 s)
  makes the front worker fail connects, which clients see as close 1006.
- Document history names each Loro peer from D1 `peer_user_map`, so every
  path that writes operations maps the peers it writes with: WebSocket and
  HTTP `/update` writes to their user and signed agent actor, `/initialize`
  snapshots to the system author (`SYSTEM_AUTHOR_ID`), and `/copy` copies the
  source's mappings first. A peer's first owner keeps it; registration only
  claims peers the system author holds.
  A new write path does the same (`tests/peer_authors.test.ts`).
- `migration-test-hooks` is test-only fault injection — never enable it in a
  deployed worker (see the feature's doc comment in `Cargo.toml`).
- Never run `just deploy-dev` / `just deploy-prod` without explicit approval.

## Related

- Docs: this directory's `README.md`

- Room `/exists` checks the durable snapshot, not the document ID set by a
  connection. To regress connect-before-initialize, build without
  `create-default-state` and run `SYNC_TEST_UNINITIALIZED_ROOMS=true npx vitest run
  tests/canvas_initialization.test.ts`; the usual test build seeds automatically.
