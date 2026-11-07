# sync_server_core

## What it is

Worker-independent synchronization policy and persisted domain models shared by
Cloudflare Durable Objects and native simulation.

## Start here

- `src/domain/room.rs`: owned private memory, configuration and read-only diagnostics.
- `src/domain/ports.rs`: runtime capabilities; local futures/errors are intentional (CS-60/CS-56).
- `src/domain/room/connection.rs`, `frame.rs`: socket lifecycle, grants, framing and telemetry.
- `src/domain/room/http.rs`, `atomic.rs`: initialization, reads and atomic updates.
- `src/domain/room/alarm.rs`, `delete.rs`: snapshot/compaction, blame and permanent erasure.
- `src/domain/room/surface.rs`, `migration.rs`, `fault.rs`: isolated lifecycles and recovery.
- `src/domain/state.rs`, `operation_log.rs`: explicit-clock imports and ordered persistence.
- `src/domain/document.rs`, `permissions.rs`: update validation and verified grant policy.

## Boundaries

- Depend on pure domain types and pinned Loro; never Worker, Tokio, sockets, HTTP or environment.
- Keep authentication, HTTP parsing/limits and runtime handles in adapters.
- Serialize complete callbacks in the adapter, including the request gate and route handler.
- Background ports receive owned snapshots/editor batches; never a room or lock guard.
- Keep memory private. `RoomMemoryView` exposes identity, mapped peers and read-only document exports.
- Preserve stored serde shapes, wire errors and named quirks in the golden corpus.

## Checks

- `cargo test -p sync_server_core -p sync_server_sim -p sync_protocol`
- `cargo check -p sync_server_core --target wasm32-unknown-unknown`
- `cargo tree -p sync_server_core` must contain no Worker, wasm-bindgen, Tokio or mio.
- Re-record the sync-service suite and require zero normalized transcript diffs.
- Run the native public-function coverage floor described in `../sync_server_sim/AGENTS.md`.

## Gotchas

- Keep this crate excluded from hakari so it remains wasm-safe.
- Import/export server documents without committing local operations.
- Presence uses clock-injected `sync_protocol::presence`, vendored from Loro 1.16.2.
- Supply UUIDs through ports and `uuid-types`; ambient randomness belongs to adapters.
- Production adapters always select `FaultPlan::None`; fault headers are test-only.
- Retain operation IDs and applied keys across same-session exists/initialize calls. Preserve A4 pending-import compaction until its separate fix.
