# models_search

## What it is

Part of the Search feature. Wire models for OpenSearch-backed full-text
search results, one module per indexed entity kind, plus the unified
cross-entity response.

## Start here

- `src/unified.rs`: `UnifiedSearchResponse` — combines every entity kind's
  search item into one ranked response; the best map of what's indexed.
- `src/document.rs`, `src/chat.rs`, `src/channel.rs`, `src/email.rs`,
  `src/call_record.rs`, `src/crm_company.rs`, `src/calendar_event.rs`,
  `src/agent_session.rs`, `src/project.rs`: per-entity response item types.
- `src/score.rs`: relevance scoring types.
- `src/simple.rs`: the simpler "goto" search response variants.

## Scope

- Owns: search response models per indexed entity kind and the unified
  response shape.
- Not here: the OpenSearch query/index logic itself → `search_service`,
  `search_processing_service`; the indexed doc models → `models_opensearch`.

## Boundaries

- Depends on: `item_filters`, `model_file_type`, `models_opensearch`,
  `models_soup`, `opensearch_client`, `document_sub_type`.
- Used by: `ai_tools`, `search_processing_service`, `search_service(_client)`,
  `skills`.

## Recipes

- Add a new indexed entity kind to search: new `src/<kind>.rs` → add its
  variant to `src/unified.rs` → `search_service` (query/index) →
  `search_processing_service` (indexing pipeline).

## Checks

- `cargo test -p models_search` (`SQLX_OFFLINE` unset).

## Gotchas

- An indexed `owner_id` is the owner's canonical principal string ("Mine"
  filters compare it directly); preserve prefixes like `bot|` when indexing.

## Related

- Rules: `.agents/rules/rust/architecture.md`
