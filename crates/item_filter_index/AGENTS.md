# item_filter_index

## What it is

Belongs to Search (Soup): compiles `EntityFilterAst` filter trees into the
generic `predicate_index` IR that decides versioned flat Soup eligibility,
one compiler per entity kind. Wasm-compatible (used in the browser soup
engine) — keep it free of native-only dependencies.

## Start here

- `src/lib.rs`: the `SOUP_FLAT_V*` profile constants (stable profile names,
  never renumber an existing one) and the `vocabulary` module.
- `src/document.rs`, `src/mail.rs`, `src/channels.rs`, `src/properties.rs`:
  one compiler module per entity kind, each turning that kind's
  `*Literal` AST nodes into `PredicateExpr`/`IndexQuery`.
- `src/test/`: compilation tests, including `confinement.rs` (that filters
  can't reach data outside their declared scope).

## Scope

- Owns: AST → predicate-index compilation and the `soup-flat-v*` profile
  vocabulary.
- Not here: the filter AST itself → `crates/filter_ast`, `crates/item_filters`;
  predicate index execution → `crates/predicate_index`; which fields a given
  profile actually serializes → the soup projection crates
  (`soup_filter_cache_adapter`, `soup_filter_projection`).

## Boundaries

- Depends on: `filter_ast`, `item_filters` (ports only), `predicate-index`.
- Used by: `soup_filter_cache_adapter`, `soup_filter_projection`.

## Recipes

- Add a filterable field for an entity kind: the `*Literal` enum in
  `item_filters` → the matching compiler module here (e.g. `src/document.rs`)
  → its `test.rs`.
- Add a new profile version: a new `SOUP_FLAT_V*` const in `src/lib.rs` →
  add it to `vocabulary` → update the compiling crate(s) that mint it.

## Checks

- `cargo test -p item-filter-index`.

## Gotchas

- `STATUS_PROPERTY_DEFINITION_ID` hardcodes `SystemPropertyKey::STATUS_UUID`
  to avoid a native dependency on `system_properties` for wasm; a native test
  locks the two values together, so don't drift them independently.

## Related

- Rules: `.agents/rules/rust/architecture.md`
