# frecency

## What it is

Shared infrastructure for Search/Soup ranking and other item lists (used by
soup, ai_tools, memory, channels, email, scheduled actions): frecency
(frequency + recency) scoring, following the hexagonal architecture pattern.

## Start here

- `src/domain/models.rs`: the score model and decay parameters.
- `src/domain/services.rs`: the scoring/ranking logic.
- `src/outbound/postgres.rs`: the SQL-side scoring adapter (recursive CTEs via
  the `recursion` crate).
- `src/inbound/polling_aggregator.rs`: the polling path that aggregates and
  persists scores.

## Scope

- Owns: frecency computation and its Postgres persistence/query adapter.
- Not here: what gets ranked or how it's displayed — callers combine this
  with their own entity filters.

## Boundaries

- Depends on: `filter_ast`, `item_filters`, `model-entity`.
- Used by: `soup`, `ai_tools`, `memory`, `channels`, `email`,
  `document_storage_service`, `connection_gateway`, `document_cognition_service`,
  `scheduled_action`, `mcp_service`, `email_service`.

## Recipes

- Add a new signal to the score: `src/domain/models.rs` → `src/domain/services.rs`
  → `src/outbound/postgres.rs`.

## Checks

- `cargo test -p frecency --all-features` (`SQLX_OFFLINE` unset).
- `just integration_test` (DynamoDB-backed cases, from this directory).

## Related

- Rules: `.agents/rules/rust/db.md`
