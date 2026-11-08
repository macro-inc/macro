# contacts_core

## What it is

Part of Contacts: the contact graph, meaning who each user knows, built from
message and call activity and explicit relationships. Models, the ports the
adapters implement, and `ContactsDomainService`. HTTP and the SQS worker are
`crates/chat/contacts_inbound`; the Postgres, SQS and connection gateway
adapters are `crates/chat/contacts_outbound`.

## Start here

- `src/service.rs`: the contacts use cases, including bounded ID pages through `ContactsPageService`; the deployed full-list API is unchanged.
- `src/service/directory.rs`: bounded enrichment, search, and membership-first lookup. Search is ID-ordered, not ranked: at most four 500-row batches are enriched per request, and empty results may have a continuation.
- `src/models/contact.rs`: viewer/person-derived normalized identity and nullable resolved names; email fallback stays with the consuming surface. `contact/identity-fixtures.json` freezes the UUIDv5 contract for viewer-scoped point reads; keep it stable for clients.
- `src/models/page.rs`: page sizes (default 100, maximum 500) and original per-row positions, distinct from canonicalized user IDs. Short/empty pages may still have continuations.
- `src/models/query.rs`: 512-byte normalized subsequence searches (including the local-part label fallback plus email), exact/first-name reference predicates applied before limiting and at most 500 raw lookup IDs, deduplicated without reordering; empty lookup never means all contacts.
- `src/models/people.rs`: the `PeopleSearchService` models behind `GET /contacts/search` (the query is `contacts_outbound`'s `src/repository/people_search.sql`).
- `lookup_contact_ids` also backs the webhook SSE contact audience (`document_storage_service` `stream_contacts` adapter): one exact `(viewer, id)` lookup per subscriber per event.
- `src/service/picture_fanout.rs`: `user.picture_changed` fan-out, paging the user's contacts (≤500/page via `contact_id_page`, never the full list); its consumer is in `contacts_inbound` and its notifier in `contacts_outbound` (`picture-fanout` feature).
- `src/ports.rs`: the traits the inbound/outbound crates implement.
- `src/models/`: contact graphs, users and the queue messages.

## Scope

- Owns: the contact graph and its use cases.
- Not here: CRM companies/contacts (external organizations) → `crates/crm`;
  connection-level presence/relay → `crates/clients/connection_gateway_client`.

## Boundaries

- Depends on: `macro_user_id`, `subsequence_match`.
- Used by: `graphql_contacts` (paged directory reads), `complete_graph`,
  `teams` (backfill on team join), `channels`, `database_sql_runner`, the
  adapter crates, and through the `contacts` facade the composition roots and
  `agent_tools`.

## Recipes

- Add an HTTP endpoint: `src/ports.rs` (port method) → `src/service.rs` →
  `contacts_inbound`'s `src/http.rs` (handler + router + swagger).

## Checks

- `cargo test -p contacts_core`

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
