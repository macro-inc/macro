# frecency_outbound

## What it is

Part of frecency scoring: the adapters behind `frecency_core`'s ports. The
Postgres storage (feature `postgres`), a mockall storage mock (feature `mock`)
and `DefaultTime`, the system clock.

## Start here

- `src/postgres.rs`: the SQL-side scoring adapter.
- `src/postgres/dynamic.rs`: filter translation to SQL (recursive CTEs via
  the `recursion` crate).

## Boundaries

- Depends on: `frecency_core`, `filter_ast`, `item_filters`.
- Used by: the composition roots, through the `frecency` facade.

## Checks

- `cargo test -p frecency_outbound --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Treat DATE property literals as non-matches; keep DATE filtering on Soup or
  OpenSearch instead of frecency.
