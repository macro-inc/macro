# cache-turso

## What it is

Part of the web client's shared infrastructure: the production Turso
(SQLite-compatible, embedded) storage adapter for `cache-core`'s normalized
GraphQL cache — native for tests/Tauri, OPFS-backed on wasm32.

## Start here

- `src/storage.rs`: `TursoStorage` — implements `cache_core::store::Storage`
  with the frozen compound-key schema and strict-head mutation leasing.
- `src/driver.rs`: Turso connection/transaction handling.
- `src/key.rs`: the compound key schema (frozen — see Gotchas).
- `src/error.rs`: `TursoStorageError` / `PhysicalResetReason`.
- `tests/storage_conformance.rs`, `tests/shared_conformance.rs`: the shared
  conformance suite every storage backend must pass.

## Scope

- Owns: translating `cache-core`'s `Storage` trait onto a real Turso database,
  on both native (tests) and wasm32 (browser, via `turso-opfs`).
- Not here: the cache engine logic itself → `crates/client/cache-core`; the
  wasm-bindgen host shell → `crates/client/cache-wasm`.

## Boundaries

- Depends on: `cache-core`, `turso_core`, `turso-opfs` (wasm32 target only).
- Used by: `cache-wasm`.

## Recipes

- Add a storage operation: implement it in `src/storage.rs` → add a case to
  `tests/storage_conformance.rs` (native) and the `tests/web.rs` wasm suite.

## Checks

- `cargo test -p cache-turso` (`SQLX_OFFLINE` unset).

## Gotchas

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- Quick Access projection version upgrades rebuild derived rows from retained normalized records; preserve the mutation queue and storage generation (covered by `src/storage/test/search_projection.rs`).

- `#![forbid(unsafe_code)]` and `#![deny(missing_docs)]` — this crate is held to
  a stricter bar than most because it's the single physical-disk commit point.
- The compound-key schema and payload encoding are frozen; an incompatible or
  uncertain on-disk state is classified for physical reset, never silently
  migrated, copied, or redirected to a fallback backend.
- The one exception is a cache format version listed in
  `MIGRATABLE_CACHE_FORMAT_VERSIONS`: `migrate_previous_format` drops the
  refetchable records, search projections, index facts, and calendar ranges in
  one transaction, keeps queued mutations, optimistic layers, and their
  projections, and rewrites the namespace. Everything else still resets.

## Related

- Rules: `.agents/rules/rust/architecture.md`
