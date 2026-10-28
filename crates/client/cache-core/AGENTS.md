# cache-core

## What it is

Part of the web client's shared infrastructure: the normalized GraphQL
cache engine — pure, native-tested core shared by every storage backend and
host (web, Tauri). Design doc:
`apps/web/docs/graphql-normalized-cache-plan.md`.

## How it works

GraphQL responses are normalized into keyed records (`normalize.rs`);
watched queries and the optimistic mutation queue read/write those records
through the predicate/projection IR; results are denormalized back into
GraphQL response shape for callers. A concrete `Storage` impl (e.g.
`cache-turso`) persists the records.

## Start here

- `src/engine.rs`: the `CacheEngine` — the crate's entry point, owns queued
  mutations, watched queries, and optimistic resolution.
- `src/normalize.rs` / `src/denormalize.rs`: GraphQL response ↔ normalized record
  transforms.
- `src/store.rs`: the `Storage` trait every backend (e.g. `cache-turso`) implements.
- `src/predicate.rs` + `src/record_selection.rs`: the predicate/projection IR
  used to select which cached records satisfy a query.
- `src/search.rs`: disposable Quick Access projection (version 3); email matches subjects and all embedded senders, never snippets or bodies.
- `src/queue.rs`: the optimistic mutation queue.
- `tests/`: the primary spec for engine behavior — one file per concern
  (optimistic updates, calendar range, search, subscriptions, fuzz).

## Scope

- Owns: normalization, denormalization, optimistic mutation resolution, watched
  queries, and the storage-agnostic predicate/projection IR.
- Not here: a concrete storage backend → `crates/client/cache-turso`; the wasm
  host shell → `crates/client/cache-wasm`; Soup-specific projection policy →
  `soup_filter_cache_adapter`, `soup_filter_projection`.

## Boundaries

- Depends on: `apollo-compiler`/`apollo-parser` (GraphQL parsing), `predicate-index`,
  `maybe_send`.
- Used by: `cache-turso`, `cache-wasm`.

## Recipes

- Add a new mutation's optimistic resolver: `src/engine.rs` (resolver registration)
  → a new `tests/<name>_optimistic.rs` first (see the existing `*_optimistic.rs` tests).
- Change what a query can select: `src/predicate.rs` → `src/record_selection.rs`
  → `src/query_inspection.rs`.

## Checks

- `cargo test -p cache-core` (`SQLX_OFFLINE` unset).

## Gotchas

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- Opaque JSON scalars must preserve floating-point values on reparse — `serde_json`
  is pulled in with the `float_roundtrip` feature; don't drop it.
- `StoredMutation.created_at_ms` is the first-enqueue time hosts report as
  `enqueuedAtMs`: a row replacing an unsent row for the same UUID inherits the
  earlier time. Lease and backoff checks take `now_ms` separately; never read
  `created_at_ms` as the current time.
- Patches structural query changes in place instead of resending full results
  (#7825); a new query shape change needs a patch path, not just a resend.

## Related

- Docs: `apps/web/docs/graphql-normalized-cache-plan.md`
