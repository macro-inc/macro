# contacts_service

## What it is

Contacts/CRM feature: thin composition root for the `contacts` domain
crate — HTTP router, an SQS worker that ingests connection events, and an
outbox worker that notifies `connection_gateway`.

## Start here

- `src/main.rs`: wires `contacts::domain::service::ContactsDomainService`,
  `contacts::inbound::http::contacts_router`, and the SQS/outbox workers — the
  actual logic lives in `crates/contacts`, not here.
- `src/config.rs`: env vars and per-environment DB pool sizing.
- `src/health.rs`: health check endpoint.

## Scope

- Owns: process startup, config, and composing `crates/contacts`'s
  inbound/outbound adapters.
- Not here: contact-matching/connection domain logic, repository queries, or
  the gateway-notification adapter — all in `crates/contacts`
  (`domain/service`, `outbound/repository`, `outbound/gateway`).

## Recipes

- Add an HTTP route: `crates/contacts` (`inbound/http`) → wired automatically
  via `contacts_router` in `src/main.rs`.
- Test the local SQS/outbox pipeline: `just create-localstack` → `just create-queue`
  → `just sqs-worker` → `just sqs-test-message`.

## Checks

- `cargo test -p contacts_service` (`SQLX_OFFLINE` unset).

## Gotchas

- `README.md` and the `just` recipes reference a `connections` table and a
  `my-test-queue`/local-SQS workflow predating the current
  `ContactsDomainService`/outbox design; treat them as a local-SQS smoke-test
  recipe, not a description of the current schema.

## Related

- Domain crate: `crates/contacts`
