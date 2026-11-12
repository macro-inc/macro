# opensearch_client

## What it is

Part of the Search feature. Typed client for Macro's search index:
per-entity-type upsert/delete and search for documents, emails, channel
messages, chats, agent sessions, calendar events, call records, and
projects.

## Start here

- `src/lib.rs`: `OpensearchClient` construction (URL + basic auth).
- `src/upsert/<entity>.rs` + `src/delete/<entity>.rs`: one pair per indexed
  entity type — the shape each indexer must produce.
- `src/search/builder.rs` + `src/search/unified.rs`: the cross-entity search
  request builder and the unified result model.
- `examples/`: runnable usage beyond the README.

## Scope

- Owns: index document shapes, OpenSearch request/response mapping, and the
  unified search query across entity types.
- Not here: the generic query DSL used to build those requests →
  `opensearch_query_builder`; deciding what gets (re)indexed and when →
  `search_service`, `services/search_processing_service`.

## Boundaries

- Depends on: `opensearch_query_builder`, `models_opensearch`,
  `models_search_cursor`.
- Used by: `models_search`, `search_service`,
  `services/document_storage_service`, `services/search_processing_service`.

## Recipes

- Index a new entity type: add `src/<entity>.rs` (doc shape) →
  `src/upsert/<entity>.rs` + `src/delete/<entity>.rs` → a `src/search/<entity>.rs`
  query if it needs its own search endpoint → wire into
  `services/search_processing_service`.
- Property DATE filters use the existing nested `properties.date_value` epoch-millisecond projection; emit only supplied inclusive/exclusive bounds and use a negated nested exists query for missing dates.

## Checks

- `cargo test -p opensearch_client` (`SQLX_OFFLINE` unset; needs a running
  OpenSearch — see `crates/opensearch_query_builder/docker-compose.yml`).

## Gotchas

- Map a failed `.send()` with `OpensearchClientError::request_failed` and a
  failed body read with `deserialization_failed`. Both take an
  `OpensearchOperation`: add a variant for a new request rather than passing a
  name. `request_failed` classifies the cause as a `TransportFailure` (timeout,
  connect, connection closed, other) and keeps the full source chain in
  `details`; reqwest's `Display` alone drops the cause. A body cut off by a
  transport failure also becomes `RequestFailed`, not `DeserializationFailed`.
- Workspace feature unification enables reqwest's HTTP/2, so every request
  from one process multiplexes over one connection, and a recycled connection
  fails them all at once. Wrap each public `OpensearchClient` method's request
  in `retry::resend_on_lost_connection`, which resends twice on a connection
  closed or refused before a complete response, never on a timeout or an
  error status. Every request must stay safe to resend: write by explicit id
  or by query.
- Put `instrument(err)` on the public method, not the inner function it
  retries, so a recovered attempt does not record an error span.
- Requests time out after five minutes (`REQUEST_TIMEOUT`); delete-by-query
  across a large mailbox runs for minutes.
- The request-level `_source` filter does not reach `has_child` inner hits:
  each one returns the child's whole document unless its `InnerHits` names
  `source_fields`. Name exactly the fields the hit's `_source` struct decodes.

## Related

- Docs: `README.md`, `examples/`
