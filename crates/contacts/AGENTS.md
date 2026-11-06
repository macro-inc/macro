# contacts

## What it is

Part of Contacts: a hexagonal service tracking who each user knows, built
from message/call activity and explicit relationships, exposed over HTTP
and kept in sync via the connection gateway.

## Start here

- `src/domain/service.rs`: the contacts use cases (`domain::service`).
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
- Used by: `contacts_service` (composition root), `teams` (backfill on team
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

- `cargo test -p contacts` (`SQLX_OFFLINE` unset; the `outbound`/`default`
  features need a local MacroDB — see `.agents/rules/rust/guardrails.md`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
