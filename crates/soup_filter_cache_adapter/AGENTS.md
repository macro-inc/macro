# soup_filter_cache_adapter

## What it is

Part of the Soup query feature (Home/Recent/Signal) — the client-side piece
that lets the app filter Soup locally without a server round-trip. A
Soup-specific host adapter for the generic `predicate-index` cache: owns the
application GraphQL schema and Soup projection policy, compiling GraphQL
Soup-filter queries down to the generic query/projection IR the cache crates
understand. Runs both natively (Tauri) and compiled to wasm (web).

## Start here

- `src/lib.rs`: the GraphQL `Document`/`Selection` → `ValidatedIndexQuery`
  compile path (`compile_soup_flat_v4`) and crate-level docs.
- `src/live_query.rs`: reactive query registration/re-evaluation.
- `src/direct_patch.rs`, `src/notifications.rs`: optimistic local mutation
  and notification projection updates applied without a server round-trip.
- `src/channels.rs`, `src/database_rows.rs`, `src/mail.rs`, `src/properties.rs`:
  per-entity-kind projection/patch logic.

## Scope

- Owns: translating GraphQL Soup filter queries into the generic cache IR,
  and projecting/patching cached entities for each kind.
- Not here: the generic predicate-index cache engine itself → `cache-core`,
  `item_filter_index`, `predicate_index`; the wire-format encoding of a
  projected entity → `soup_filter_projection`.

## Boundaries

- Depends on: `cache-core`, `item_filter_index`, `predicate_index`,
  `graphql_soup_filter_input`, `soup_filter_projection` (no-default-features).
- Used by: `apps/web/tauri/graphql_cache_plugin` (native) and
  `crates/client/cache-wasm` (wasm, web).

## Recipes

- Add a filterable/projectable field: `item_filter_index`/`predicate_index`
  (if the vocabulary is new) → `soup_filter_projection` (wire encoding) →
  the matching `src/<kind>.rs` here (projection + optimistic patch).

## Checks

- `cargo test -p soup-filter-cache-adapter` (`SQLX_OFFLINE` unset).

## Gotchas

- This crate must stay wasm-compatible — no `sqlx`, no native-only crates in
  default features; native-only test fixtures live under
  `[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]`.

## Related

- Rules: `.agents/rules/web/data.md`
