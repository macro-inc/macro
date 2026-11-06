# email_scheduled_handler

## What it is

Email feature: Lambda, triggered every minute by EventBridge, that finds
due delivery/reconciliation work and terminal deferred message deletions, then
publishes a `ScheduledPubsubMessage` for the email worker to process.

## Start here

- `src/outbound.rs`: recovery selection and queue adapters;
  `src/handler.rs` invokes the email domain recovery scanner;
  `README.md` explains the trigger cadence and the `scheduled_messages` table.

## Scope

- Owns: repeatedly finding eligible durable work and publishing wakeups; worker
  claims provide fencing and idempotency.
- Not here: provider submission, reconciliation, or deferred-deletion application →
  `email_service`'s scheduled message worker (`src/pubsub/scheduled`).

## Checks

- `cargo test -p email_scheduled_handler` (`SQLX_OFFLINE` unset).

## Gotchas

- #6617 reverted a "replay historical sends" change and #6580 fixed a send
  stranded by a failed enqueue — read those commits before changing the
  fetch/publish ordering (`git log -- services/email_scheduled_handler`).
