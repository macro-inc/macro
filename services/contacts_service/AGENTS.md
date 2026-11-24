# contacts_service

## What it is

Contacts/CRM feature: thin composition root for the `contacts` domain
crate — HTTP router, an SQS worker that ingests connection events, and an
outbox worker that notifies `connection_gateway`.

## Start here

- `src/main.rs`: wires `contacts::domain::service::ContactsDomainService`,
  `contacts::inbound::http::contacts_router`, and the SQS/outbox workers — the
  actual logic lives in `crates/contacts`, not here. The router reads through
  `FlaggedContactReads`, so `GET /contacts` and `GET /contacts/search` follow
  each caller's `contacts-list-reads` flag, while
  `GET /contacts/lists/{list}/members` reads the list-aware tables for every
  caller; the workers write through the domain service directly.
- `src/config.rs`: optional `POSTHOG_API_KEY`/`POSTHOG_HOST` (Doppler
  `contacts-service` dev and prd). Unset or blank, every caller reads the
  legacy graph; a flag load waits at most 300 ms.
- `src/config.rs`: env vars and per-environment DB pool sizing.
- `src/health.rs`: health check endpoint.
- `src/bin/contacts_backfill.rs`: clap CLI for the contact list backfill and
  legacy-graph audit (`crates/contacts` `domain::backfill`); usage and run
  order in `README.md`. Never run it against dev or prod without approval.

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

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
