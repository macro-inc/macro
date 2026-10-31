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
- Name mode sources: chats (`simple/simple_chat.rs`) and channels
  (`simple/simple_channel.rs`) name-search in Postgres through `name_search`;
  every other type name-searches in OpenSearch. `simple_unified.rs` merges
  them and keeps one cursor slot per source.
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
  `entity_access`, `properties`, `crm`, `item_filters`, `calendar_events`
  (domain only, no features, for its Macro call rule).
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

## Gotchas

- Every whitespace-split term is ANDed, so a term the standard tokenizer
  analyzes to nothing (`-`, `@`) matches no document and empties the search.
  `terms::drop_wordless_terms` removes such terms for exact and partial
  queries; run new term handling through it.
- Calendar events have two scopes (`calendar_event_scope` on the unified
  request): `own` matches the caller's own and delegated calendars by
  owner and inbox link; `shared_with_you` resolves the events shared with the
  caller's channels in Postgres and searches by id, leaving out meetings the
  caller holds a copy of. Enrichment re-checks every hit against the event's
  access rule. A caller who does not hold the meeting gets no conference link,
  and `calendar_events`' `content_without_macro_call` takes the Macro call out
  of the description; a provider's own join text in the body stays, as it does
  in a mention preview. Enrichment is the only gate: an id named in the `own`
  scope reaches a share as well. The index stores titles, never the description
  or location, so hits and highlights cannot carry the link.

## Related

- Rules: `.agents/rules/rust/architecture.md`
