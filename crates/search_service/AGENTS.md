# search_service

## What it is

Part of the Search feature. OpenSearch-backed search API —
per-entity-type search plus a unified search across them — mounted into
`document_storage_service`, not run standalone.

## Start here

- `src/api.rs` + `src/api/search.rs`: the router; one file per entity type
  under `src/api/search/` (`document.rs`, `email.rs`, `chat.rs`, `channel.rs`,
  `calendar_event.rs`, `call_record.rs`, `crm_company.rs`, `project.rs`,
  `agent_session.rs`), plus `unified.rs` for cross-type search.
- `src/api/search/simple/`: a second, simpler request/response shape per type
  used by AI tools — kept in sync with the full one by hand.
- `src/api/context.rs`: `SearchHandlerState`, the shared handler state.
- `src/outbound.rs` + `src/outbound/agent_session.rs`: the OpenSearch query
  builders.

## Scope

- Owns: query construction against the `models_opensearch` index and the
  HTTP surface for searching each entity type.
- Not here: indexing/backfill (the writer side) or the service binary that
  hosts this router → `document_storage_service`.

## Boundaries

- Depends on: `opensearch_client`, `models_opensearch`, `macro_db_client`,
  `entity_access`, `properties`, `crm`, `item_filters`.
- Used by: `document_storage_service` (mounts `search_router`); called
  through `search_service_client`.

## Recipes

- Add search for a new entity type: `src/api/search/<type>.rs` (handler) →
  `src/outbound.rs` (OpenSearch query) → `src/api/search.rs` (route) →
  `src/openapi.rs` → a matching `src/api/search/simple/simple_<type>.rs` if
  AI tools need it.
- Change the unified search ranking/shape: `src/api/search/unified.rs` and
  its `src/api/search/simple/simple_unified.rs` counterpart together.

## Checks

- `cargo test -p search_service` (`SQLX_OFFLINE` unset).
- `SQLX_OFFLINE=true cargo check` (`just check` recipe in `justfile`).

## Related

- Rules: `.agents/rules/rust/architecture.md`
