# sync_server_core

## What it is

Worker-independent synchronization policy and persisted domain models shared by
the Durable Object adapter and native simulation.

## Start here

- `src/domain/document.rs`: atomic update and snapshot policy.
- `src/domain/permissions.rs`: verified grants and permission checks.
- `src/domain/state.rs`: imported document state with explicit monotonic time.
- `src/domain/ports.rs`: runtime capability contracts, with non-Send futures.
- `src/domain/room.rs`: owned memory and configuration; adapters serialize callbacks.
- `src/domain/room/http.rs`: initialization, reads and source-request gate policy.
- `src/domain/room/alarm.rs`: snapshot/compaction order, blame flushing and alarm re-arm policy.
- `src/domain/operation_log.rs`: pending-write order, replay and snapshot policy.
- `src/domain/connection.rs`: persisted metadata and explicit-time grant policy.
- `src/domain/migration.rs`: persisted migration states.

## Boundaries

- Depends on pure domain types and Loro; no Worker, Tokio, sockets or environment.
- Used by `services/sync-service` and `crates/sync_server_sim`; authentication stays in that adapter.
- Keep persisted serde shapes and error text compatible with the golden corpus.

## Checks

- `cargo test -p sync_server_core`
- `cargo check -p sync_server_core --target wasm32-unknown-unknown`
- `cargo tree -p sync_server_core` contains no Worker, wasm-bindgen, Tokio or mio.
- Run the sync-service suite and compare a fresh transcript recording.

## Gotchas

- Server documents import and export without committing; committing requires an
  explicitly assigned peer. Preserve Loro's pinned version.
- Keep this crate excluded from hakari so it remains wasm-safe.
- Use `uuid-types` for supplied identifiers; ambient UUID generation belongs to adapters.

`RoomMemory` owns the document, operation log, metadata and pending batches. Its
hidden accessors temporarily support Worker handler bodies during extraction;
keep runtime handles and locks in the adapter. Presence uses `sync_protocol::presence` vendored from Loro 1.16.2; all time-dependent calls receive the room clock. Connection, close, lazy metadata restore, grant validation and
heartbeat policy live in `src/domain/room/connection.rs`; inbound binary
frame dispatch, comment-gate policy and message telemetry live in `frame.rs`; runtime socket handles
remain callback arguments. Local rootcause reports retain non-Send port errors.

Atomic document snapshot/update orchestration lives in `src/domain/room/atomic.rs`; HTTP method, streaming limits and JSON/base64 parsing remain in the Worker adapter.

Session deletion order and volatile cleanup live in `src/domain/room/delete.rs`; snapshot adapters remove fallback storage before primary storage.
