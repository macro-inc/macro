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
- `../../crates/sync_server_core/src/domain/room/http.rs`: initialization, reads and source-request gate policy; handlers retain deferred body reads.
- `../../crates/sync_server_core/src/domain/room/alarm.rs`: persistence alarms and blame flushing; callbacks map its empty/ok outcomes.
- `../../crates/sync_server_core/src/domain/room/frame.rs`: inbound frame policy and message telemetry, including the fail-closed HTTP comment gate.
- `src/inbound/durable_object.rs` + `src/inbound/durable_object/document_api.rs`: the Durable
  Object — WebSocket handling, loro document state, alarm-driven snapshotting.
- `src/inbound/durable_object/surface_api.rs`, `surface_migration.rs`: non-document
  surfaces (spreadsheets, forms, etc.) hosted the same way.
- `src/outbound/room_ports.rs`: Worker implementations of the core room ports.
- `src/outbound/storage/` + `src/outbound/storage/backends/`: snapshot/op-log transport,
  pluggable across D1/KV/R2/combined backends (see the Cargo feature flags);
  write ordering and replay policy live in `sync_server_core::domain::operation_log`.
- `src/inbound/auth.rs` + `src/inbound/credentials.rs`: route-specific access
  extractors and JWT verification against tokens minted by
  `document_storage_service`.
- `../../crates/sync_protocol/`: shared Bebop wire types, schema and codegen
  for Rust and TypeScript bindings.

- `src/inbound/router.rs` + `src/inbound/worker.rs`: Axum document/surface
  routing and worker proxy/copy orchestration.
- `../../crates/sync_server_core/src/domain/`: shared session permission policy,
  atomic update use cases, connection metadata and migration state.
- `src/domain.rs`: compatibility re-exports of the shared core.
- `../../crates/sync_server_core/src/domain/room/connection.rs`: connect/close, metadata restore and surface-grant validation policy.
- `src/outbound/room_ports.rs`: Worker clocks; document state and migration proof decoding live in core.

## Scope

- Owns: real-time sync of Loro documents over WebSocket, snapshot
  persistence, and the sync-service's own auth/permission checks on
  established connections.
- Not here: minting the document-access JWT → `document_storage_service`;
  document domain logic → the owning domain crate (e.g. `collab_surface`).

## Recipes

- Change the wire protocol with the repository-pinned Bebop generator; update
  both service and collaboration package bindings (see README), then
  `node ../../crates/sync_protocol/bebop/generate.mjs` regenerates both bindings.
- Add a storage backend: `src/outbound/storage/backends/` (new file + `mod.rs`) → gate
  it behind a new feature in `Cargo.toml` → wire into `src/outbound/storage.rs`.
- Add a non-document surface: `src/inbound/durable_object/surface_api.rs` →
  `../../crates/sync_server_core/src/domain/room/surface.rs` → migration policy in
  `../../crates/sync_server_core/src/domain/room/migration.rs` if it changes stored shape.

Active-peer queries with `include_ai=false` exclude signed agent actors and the
reserved AI peer blocks (`sync_server_core::domain::ai_peer`); Canvas workers use random full-width
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
- `setupMiniflare` tracks runtimes and awaits disposal at suite teardown; explicit
  disposal remains safe and is shared with transcript finalization.
- Use Node.js 22.12+/24.x/26+ for Vitest 5; install JS deps with `npm ci`
  (`package-lock.json` is authoritative, not `bun.lock`).

- `COMMENT_GATE_MODE` is required per room (`http`, `in_process`, `shadow`); every checked-in environment defaults to HTTP. Invalid configuration refuses gate checks; shadow returns HTTP and reports only equality.

## Gotchas

- Keep `loro-crdt` pinned to 1.17.1, matching the root Rust dependency and Bun
  catalog. Bumping it touches three lockfiles: `bun.lock`, the workspace
  `Cargo.lock`, and this directory's `package-lock.json` — update all three.
- Durable Object in-memory state (including the loro document) evicts after
  10s of inactivity even with open connections; the alarm-based heartbeat in
  `src/keepalive.rs` is what keeps it warm, not WebSocket traffic.
- The Durable Object handles one request or WebSocket message at a time
  (`Arc<futures::lock::Mutex<Room<WorkerPorts>>>` in `src/inbound/durable_object.rs`). Keep per-update work
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
- `transcript` is test-only boundary capture; never enable it in a deployed worker.
  `just record-transcripts` records the Vitest suite; `just diff-transcripts`
  compares it with the committed corpus. See `../../crates/sync_server_sim/tests/transcripts/COVERAGE.md`.
  The local test wrapper uses Miniflare 4.20260625+ for socket-preserving eviction.
- `migration-test-hooks` is test-only fault injection — never enable it in a
  deployed worker (see the feature's doc comment in `Cargo.toml`).
- Provision `LEXICAL_SERVICE_AUTH_KEY` to match lexical-service before deploying; `just check-secrets <environment>` checks binding presence without reading values.
- Deploy `PeerCommentUpdate` support before clients send it; validate these frames as comment-only for editors as well as commenters, and reject viewers.
- Never run `just deploy-dev` / `just deploy-prod` without explicit approval.
- Wait at least five minutes after a manual worker deployment before publishing clients that require its new protocol; the CI worker job waits out Durable Objects' default 300-second code-update deferral.
- A new input to the worker's bundle that lives outside its workspace closure must be added to `.github/scripts/sync-worker-key.sh`, or CI can skip deploying a changed worker.

## Related

- Docs: this directory's `README.md`

- Room `/exists` checks the durable snapshot, not the document ID set by a
  connection. To regress connect-before-initialize, build without
  `create-default-state` and run `SYNC_TEST_UNINITIALIZED_ROOMS=true npx vitest run
  tests/canvas_initialization.test.ts`; the usual test build seeds automatically.

- Preserve signed document-grant agent correlation in editor metadata and pending batches; different invocations remain distinct editors.

The request gate and Axum handler share one owned room guard (CS-61). `HttpHandlers`
borrows only Room for request decoding and response serialization; it owns no session
memory. WebSocket/alarm/close adapters call Room directly. The error callback stays
lock-free. Background effects receive owned snapshots and editor batches. Same-session exists/initialize retain the operation log. Compaction retains
unresolved updates until their dependencies arrive.

All room policy lives under `../../crates/sync_server_core/src/domain/room/`:
connections/frames, HTTP reads/atomic updates, alarms/deletion, surfaces/migration.
The Worker retains credential verification, body limits, HTTP parsing and runtime
transports. Native replay and fault recovery run with
`cargo test -p sync_server_core -p sync_server_sim -p sync_protocol` from the root;
see `../../crates/sync_server_sim/AGENTS.md` for coverage and transcript recipes.
