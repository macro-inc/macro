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
- `src/mail/reconciliation.rs`: invalidate contradicted Mail facts during an
  authoritative `Soup` first-page write. Use the supported view/filter and
  microsecond timestamp/key boundary; never infer thread deletion. Skip
  backfills, partial/cursor pages, identity switches, and pending optimistic
  rows. At most 500 local matches are checked per write; later full snapshots
  restore completeness.
- `src/mail/retention.rs`: retain same-query server rows while local facts are
  incomplete, reject proven nonmembers, and preserve the indexed cursor.

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

- Mail pages reconcile server membership through the generic predicate engine;
  retain unknown projections with their supplied sort values, exclude confirmed
  nonmembers, and keep continuation cursors on the original indexed window.
  Reconcile only baseline rows outside that window; known live flags may reject
  incomplete rows through predicate simplification, never establish new membership.
  Exclude explicitly invalidated (`Dirty`) baseline rows in the queried scope
  unless an optimistic shadow takes precedence; an older reader must not undo
  authoritative first-page repair. Missing facts still retain server membership.

- This crate must stay wasm-compatible — no `sqlx`, no native-only crates in
  default features; native-only test fixtures live under
  `[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]`.
- Native apps run this crate from their binary while the web bundle updates
  over the air, so web code meets older versions. Requests use
  `deny_unknown_fields`: send a new field only once a result shows the engine
  supports it, as `endCursor` does for a Mail page's `through`.

## Related

- Rules: `.agents/rules/web/data.md`
