# soup_filter_projection

## What it is

Part of the Soup query feature (Home/Recent/Signal) — direct-field Soup
projection helpers and the versioned wire format for caching an authoritative
Soup entity's filterable facts, shared by server and client-side cache code.

## Start here

- `src/lib.rs`: `validate_soup_flat_v2/v3/v4` (profile versions) and the
  top-level projection error type.
- `src/wire.rs`: the capsule wire format (`SoupCacheProjectionCapsuleV1/V2/V3`,
  `encode_cache_projection_supplement`/`decode_cache_projection_supplement`) —
  the versioning scheme a cache client decodes against.
- `src/channel.rs`, `src/database_row.rs`, `src/profile.rs`: per-entity-kind
  projection from a hydrated model (behind the `models` feature) to the flat
  cache shape.

## Scope

- Owns: the versioned flat-projection schema and its encode/decode, decoupled
  from any specific cache engine.
- Not here: compiling GraphQL filter queries or applying optimistic patches →
  `soup_filter_cache_adapter`; the Soup domain models themselves → `soup`.

## Boundaries

- Depends on: `item_filter_index`, `predicate_index`, `document_sub_type`;
  `models`/`soup` only with default features enabled (native builds).
- Used by: `complete_graph`, `graphql_soup`, `soup_filter_cache_adapter`.

## Recipes

- Bump the wire format: add a new `SoupCacheProjectionCapsuleVN` + version
  const in `src/wire.rs`, keep decoding every older version, and update
  `SOUP_CACHE_PROJECTION_WIRE_VERSION` to the new default.
- Add a projectable field: the matching `src/<kind>.rs` → `src/profile.rs`
  validation → `src/wire.rs` if it needs a new capsule version.

## Checks

- `cargo test -p soup-filter-projection` (`SQLX_OFFLINE` unset).
- `cargo test -p soup-filter-projection --no-default-features` for the
  wasm-facing (model-free) build.

## Gotchas

- `default-features = false` (no `models`) is the wasm-safe build; don't add a
  non-optional dependency on `soup`/`models_soup` outside the `models` feature.
- Decoding must stay backward-compatible with every `SOUP_CACHE_PROJECTION_WIRE_VERSION_V*`
  still in the wild — never remove an old decode branch.

## Related

- Rules: `.agents/rules/web/data.md`
