# contacts

## What it is

Part of Contacts: a hexagonal service tracking who each user knows, built
from message/call activity and explicit relationships, exposed over HTTP
and kept in sync via the connection gateway.

## Start here

- `src/domain/service.rs`: the contacts use cases (`domain::service`), including bounded ID pages through `ContactsPageService`; the deployed full-list API is unchanged.
- `src/domain/service/directory.rs`: bounded enrichment, search, and membership-first lookup. Search is ID-ordered, not ranked: at most four 500-row batches are enriched per request, and empty results may have a continuation.
- `src/domain/models/contact.rs`: viewer/person-derived normalized identity and nullable resolved names; email fallback stays with the consuming surface. `contact/identity-fixtures.json` freezes the UUIDv5 contract shared with frontend point reads; change neither side independently.
- `src/outbound/names.rs`: `directory-names` feature, reusing the existing user-name owner's profile-over-address-book query without duplicating SQL.
- `src/domain/models/page.rs`: page sizes (default 100, maximum 500) and original per-row positions, distinct from canonicalized user IDs. Short/empty pages may still have continuations.
- `src/domain/models/query.rs`: 512-byte normalized searches (including the local-part label fallback plus email) and at most 500 raw lookup IDs, deduplicated without reordering; empty lookup never means all contacts.
- `src/outbound/repository/page.rs`: indexed paging of both graph directions and self, plus exact lookups through `lookup.sql`. Membership is bounded per input key before name reads; keep its LATERAL limit and the 100k-row plan regressions.
- `src/domain/ports.rs`: the traits `inbound`/`outbound` implement.
- `src/inbound/http.rs`: HTTP handlers, router, DTOs, swagger.
- `src/inbound/worker.rs`: SQS worker that ingests contact-affecting events.
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

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
