# contacts_outbound

## What it is

Part of Contacts: the adapters behind `contacts_core`'s ports. The Postgres
repository, the SQS ingress queue, and the connection gateway notifier that
announces graph changes.

## Start here

- `src/repository.rs`: Postgres adapter.
- `src/gateway.rs`: connection gateway notifier.
- `src/ingress.rs`: SQS-backed ingress queue.

## Boundaries

- Depends on: `contacts_core`.
- Used by: the composition roots and `ai_tools`, through the `contacts`
  facade.

## Recipes

- Add a repository query: `src/repository.rs` → its `test.rs`.

## Checks

- `cargo test -p contacts_outbound` (`SQLX_OFFLINE` unset; needs a local
  MacroDB — see `.agents/rules/rust/guardrails.md`).
