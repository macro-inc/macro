# contacts

## What it is

Part of Contacts: a hexagonal service tracking who each user knows, built
from message/call activity and explicit relationships, exposed over HTTP
and kept in sync via the connection gateway.

## Start here

- `src/domain/service.rs`: the contacts use cases (`domain::service`), including bounded ID pages through `ContactsPageService`; the deployed full-list API is unchanged.
- `src/domain/service/directory.rs`: bounded enrichment, search, and membership-first lookup. Search is ID-ordered, not ranked: at most four 500-row batches are enriched per request, and empty results may have a continuation.
- `src/domain/models/contact.rs`: viewer/person-derived normalized identity and nullable resolved names; email fallback stays with the consuming surface. `contact/identity-fixtures.json` freezes the UUIDv5 contract for viewer-scoped point reads; keep it stable for clients.
- `src/outbound/names.rs`: `directory-names` feature, reusing the existing user-name owner's profile-over-address-book query without duplicating SQL.
- `src/domain/models/page.rs`: page sizes (default 100, maximum 500) and original per-row positions, distinct from canonicalized user IDs. Short/empty pages may still have continuations.
- `src/domain/models/query.rs`: 512-byte normalized subsequence searches (including the local-part label fallback plus email), exact/first-name reference predicates applied before limiting and at most 500 raw lookup IDs, deduplicated without reordering; empty lookup never means all contacts.
- `src/outbound/repository/page.rs`: indexed paging of both graph directions and self, plus exact lookups through `lookup.sql`. Match peers with `lower(... COLLATE "C")` and the strict `macro|` prefix predicate using the two scoped expression indexes; keep raw viewer equality and raw page cursors unchanged. Membership is bounded per input key before names; preserve the LATERAL limit and both custom/generic 100k-row plan regressions. Deploy migrations `20261105044718` and `20261105044750` before the lookup query.
- `lookup_contact_ids` also backs the webhook SSE contact audience (`document_storage_service` `stream_contacts` adapter): one exact `(viewer, id)` lookup per subscriber per event.
- `src/domain/ports.rs`: the traits `inbound`/`outbound` implement.
- `src/inbound/http.rs`: HTTP handlers, router, DTOs, swagger.
- `src/inbound/worker.rs`: SQS worker that ingests contact-affecting events.
- `src/domain/service/picture_fanout.rs`, `src/inbound/user_picture_consumer.rs`, `src/outbound/picture_gateway.rs` (`picture-fanout` feature): `macro.users` `user.picture_changed` → pages the user's contacts (≤500/page via `contact_id_page`, never the full list) and sends gateway message `user_picture_changed` `{"user_id"}` to each page (self included). The consumer (group `contacts-user-picture`) batches records for 250ms/100 records and fans out once per user per batch; failures retry 3× then are logged and skipped (realtime is best-effort). Hosted in `document_storage_service`; Kafka IAM is cluster-wide, so no infra change.
- `src/outbound/repository.rs`: Postgres adapter; `src/outbound/gateway.rs`
  notifies the connection gateway of graph changes.

## Scope

- Owns: the contact graph (who a user has an explicit or inferred
  relationship with) and its HTTP/queue surface.
- Not here: CRM companies/contacts (external organizations) → `crates/crm`;
  connection-level presence/relay → `crates/connection_gateway_client`.

## Boundaries

- Depends on: `macro_authorization` (axum feature), `rate_limit`, `sqs_worker`,
  `macro_user_id`.
- Used by: `graphql_contacts` (paged directory reads), `contacts_service` (composition root), `teams` (backfill on team
  join), `channels`, `ai_tools`, `databases_sql`; also linked into
  `document_storage_service`, `authentication_service`, `email_service`,
  `agent_harness_service`.

## Recipes

- Add an HTTP endpoint: `src/domain/ports.rs` (port method) →
  `src/domain/service.rs` → `src/inbound/http.rs` (handler + router + swagger).
- Change what triggers a contact update: `src/inbound/worker.rs` (SQS message
  parsing) → `src/domain/service.rs`.
- Add a repository query: `src/outbound/repository.rs` → its `test.rs`.

## Checks

- `cargo test -p contacts --all-features -- --test-threads=2` (`SQLX_OFFLINE` unset; `directory-names` covers name precedence/account isolation; the `outbound`/`default`
  features need a local MacroDB — see `.agents/rules/rust/guardrails.md`).

- `cargo test -p contacts --all-features '::case_lookup::' -- --test-threads=2 --nocapture`: canonical point lookup matches legacy-case IDs exposed by paging, rejects invalid marker/Unicode aliases and other viewers, and seeks the new expression indexes at 100k under custom/generic plans. Directory-name tests also preserve viewer-private labels and normalized identities.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
