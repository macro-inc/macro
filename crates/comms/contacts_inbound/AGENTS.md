# contacts_inbound

## What it is

Part of Contacts: the HTTP handlers, router, DTOs and swagger (feature
`axum`) and the SQS worker that ingests contact-affecting events (feature
`worker`), both driving `contacts_core`'s service.

## Start here

- `src/http.rs`: handlers, router and swagger.
- `src/worker.rs`: SQS message parsing and the worker loop.

## Boundaries

- Depends on: `contacts_core`, `macro_authorization` (axum), `rate_limit`,
  `sqs_worker`.
- Used by: `services/contacts_service`, through the `contacts` facade.

## Recipes

- Change what triggers a contact update: `src/worker.rs` (SQS message
  parsing) → `contacts_core`'s `src/service.rs`.

## Checks

- `cargo test -p contacts_inbound`
