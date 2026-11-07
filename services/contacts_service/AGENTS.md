# contacts_service

## What it is

Contacts/CRM feature: thin composition root for the `contacts` domain
crate — HTTP router, an SQS worker that ingests connection events, and an
outbox worker that notifies `connection_gateway`.

## Start here

- `src/main.rs`: wires `contacts::domain::service::ContactsDomainService`,
  `contacts::inbound::http::contacts_router`, and the SQS/outbox workers — the
  actual logic lives in `crates/comms/chat/contacts_*`, not here.
- `src/config.rs`: env vars and per-environment DB pool sizing.
- `src/health.rs`: health check endpoint.

## Scope

- Owns: process startup, config, and composing the contacts crates'
  inbound/outbound adapters.
- Not here: contact-matching/connection domain logic, repository queries, or
  the gateway-notification adapter — in `crates/comms/contacts_core`
  (`service`) and `crates/comms/contacts_outbound` (`repository`, `gateway`).

## Recipes

- Add an HTTP route: `crates/comms/contacts_inbound` (`src/http.rs`) → wired automatically
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

- Domain crates: `crates/comms/contacts_core`, `contacts_inbound`,
  `contacts_outbound` (`crates/comms/contacts` is a re-export facade)

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
