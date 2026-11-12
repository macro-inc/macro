# stripe_inbox

## What it is

Part of billing: the Stripe event inbox. The webhook stores each verified
event; per-consumer cursors apply them in order per Stripe customer, with
retries and dead-lettering; a daily audit compares Stripe with what Macro
holds. Design: `docs/architecture/stripe-event-inbox.md`.

## Start here

- `src/domain/translate.rs`: the only code that reads Stripe JSON. Webhook
  payloads (endpoint version: `2019-12-03` on dev, `2025-09-30.clover` on
  prod) and API reads (`async-stripe`'s `2023-10-16`) become the same facts.
- `src/domain/model.rs`: `Consumer` (who applies which event types),
  `BillingInboxEvent`, `Delivery`.
- `src/domain/service.rs`: `receive` (webhook) and `run_pass` (worker).
- `src/outbound/pg.rs`: tables, leasing, the generation check on release.

## Scope

- Owns: `stripe_events`, `stripe_event_cursor`, `stripe_objects`,
  `stripe_customer_listing`, `stripe_audit_run`, `stripe_audit_mismatch`.
- Not here: what an event means for a domain. Consumers implement
  `EventConsumers` in the host (`services/authentication_service`
  `src/outbound/stripe_consumers.rs`).

## Boundaries

- Depends on: `async-stripe` (ids and raw reads), `macro_user_id`.
- Used by: `services/authentication_service` (webhook, worker, audit,
  `POST /internal/stripe_inbox/replay`).

## Recipes

- Add a consumer: `Consumer` + its `event_types` → the `stripe_consumer`
  enum in a migration → the host's `EventConsumers::apply`.
- Support a new endpoint API version: a fixture per event type in
  `fixtures/` and a translator test → `SUPPORTED_API_VERSIONS`. Events in
  an unsupported version dead-letter.

## Checks

- `cargo test -p stripe_inbox` (`SQLX_OFFLINE` unset; DB tests need a
  migrated MacroDB).

## Gotchas

- Consumers must be idempotent: a cursor advances after the apply returns,
  so a crash replays the last event. Stripe writes use
  `Idempotency-Key = <consumer>:<event_id>:<action>`.
- `ApplyError::Reject` dead-letters at once; `Retry` backs off from 5 s,
  doubling to 1 h, and dead-letters after `MAX_ATTEMPTS` (about six hours).
  A new event never re-arms a dead cursor; replay does.
- Same-second events order by event id, which is not Stripe's order; the
  projection keeps the later-received snapshot on a tie.
- Log messages `stripe inbox cursor dead-lettered`, `stripe inbox backlog`
  and `stripe audit mismatch` are monitor contracts
  (`infra/stacks/monitoring/monitors/stripe-inbox.ts`).
