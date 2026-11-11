# contacts_core

## What it is

Part of Contacts: the contact graph, meaning who each user knows, built from
message and call activity and explicit relationships. Models, the ports the
adapters implement, and `ContactsDomainService`. HTTP and the SQS worker are
`crates/comms/contacts_inbound`; the Postgres, SQS and connection gateway
adapters are `crates/comms/contacts_outbound`.

## Start here

- `src/service.rs`: the contacts use cases, including bounded ID pages through `ContactsPageService`; the deployed full-list API is unchanged.
- `src/service/directory.rs`: bounded enrichment, search, and membership-first lookup. Search is ID-ordered, not ranked: at most four 500-row batches are enriched per request, and empty results may have a continuation.
- `src/models/contact.rs`: viewer/person-derived normalized identity and nullable resolved names; email fallback stays with the consuming surface. `contact/identity-fixtures.json` freezes the UUIDv5 contract for viewer-scoped point reads; keep it stable for clients.
- `src/models/page.rs`: page sizes (default 100, maximum 500) and original per-row positions, distinct from canonicalized user IDs. Short/empty pages may still have continuations.
- `src/models/query.rs`: 512-byte normalized subsequence searches (including the local-part label fallback plus email), exact/first-name reference predicates applied before limiting and at most 500 raw lookup IDs, deduplicated without reordering; empty lookup never means all contacts.
- `lookup_contact_ids` also backs the webhook SSE contact audience (`document_storage_service` `stream_contacts` adapter): one exact `(viewer, id)` lookup per subscriber per event.
- `src/ports.rs`: the traits the inbound/outbound crates implement.
- `src/service/picture_fanout.rs`, `contacts_inbound/src/user_picture_consumer.rs`, `contacts_outbound/src/picture_gateway.rs` (`picture-fanout` feature): `macro.users` `user.picture_changed` → pages the user's contacts (≤500/page via `contact_id_page`, never the full list) and sends gateway message `user_picture_changed` `{"user_id"}` to each page (self included). The consumer (group `contacts-user-picture`) batches records for 250ms/100 records and fans out once per user per batch; failures retry 3× then are logged and skipped (realtime is best-effort). Hosted in `document_storage_service`; Kafka IAM is cluster-wide, so no infra change.
- `src/models/`: contact graphs, users and the queue messages.

## Scope

- Owns: the contact graph and its use cases.
- Not here: CRM companies/contacts (external organizations) → `crates/databases/crm`;
  connection-level presence/relay → `crates/clients/connection_gateway_client`.

## Boundaries

- Depends on: `macro_user_id`, `subsequence_match`.
- Used by: `graphql_contacts` (paged directory reads), `teams` (backfill on team join), `channels`, `database_sql_runner`, the
  adapter crates, and through the `contacts` facade the composition roots and
  `agent_tools`.

## Recipes

- Add an HTTP endpoint: `src/ports.rs` (port method) → `src/service.rs` →
  `contacts_inbound`'s `src/http.rs` (handler + router + swagger).

## Checks

- `cargo test -p contacts_core`

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
