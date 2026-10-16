# opensearch_query_builder

## What it is

Part of the Search feature. Type-safe builders for OpenSearch query DSL
and request bodies (bool, match, range, nested, terms, function_score,
...), each implementing `ToOpenSearchJson`, used by `opensearch_client`.

## Start here

- `src/lib.rs`: the `ToOpenSearchJson` trait and the public re-exports — the
  crate's whole surface.
- `src/query/`: one file per query type.
- `src/request.rs` + `src/request/`: sort, highlight, collapse, and
  aggregation request fragments.

## Scope

- Owns: building valid OpenSearch JSON query/request bodies from typed Rust
  structs.
- Not here: knowing which entity fields to query or how to index documents
  → `opensearch_client`.

## Boundaries

- Used by: `opensearch_client` only.

## Recipes

- Add a new query type: `src/query/<name>.rs` (struct + builder + `impl
  ToOpenSearchJson`) → `pub use` it in `src/lib.rs` → `src/query.rs` module
  declaration.

## Checks

- `cargo test -p opensearch_query_builder` (`SQLX_OFFLINE` unset).
- `docker-compose.yml` here starts a local OpenSearch for `examples/`.

## Related

- Docs: `README.md`, `examples/`
