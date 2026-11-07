# sync_server_core

## What it is

Worker-independent synchronization policy and persisted domain models shared by
the Durable Object adapter and native simulation.

## Start here

- `src/domain/document.rs`: atomic update and snapshot policy.
- `src/domain/permissions.rs`: verified grants and permission checks.
- `src/domain/state.rs`: imported document state with explicit monotonic time.
- `src/domain/connection.rs`: persisted metadata and explicit-time grant policy.
- `src/domain/migration.rs`: persisted migration states.

## Boundaries

- Depends on pure domain types and Loro; no Worker, Tokio, sockets or environment.
- Used by `services/sync-service`; authentication stays in that adapter.
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
