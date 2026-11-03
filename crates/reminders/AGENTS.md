# reminders

## What it is

Part of the Email feature, plus one-shot reminders that open a channel
message. Private email snoozes: durable inbox restoration, scheduled
dispatch, and notification delivery, plus email follow-up reminders.

## Start here

- `src/domain.rs` module list: `email_collection` (snooze/restore),
  `email_followup` (follow-up reminders), and `channel_message` (open a
  channel message later).
- `src/domain/service/dispatch.rs`: the recurring dispatch loop shared by email
  snoozes and channel-message reminders.
- `src/inbound/dispatch_worker.rs`: the queue worker entry point (`dispatch` feature).
- `src/outbound/pg_reminders_repo.rs`: Postgres repo, split by sub-area.

## Scope

- Owns: email snooze scheduling/restoration, email follow-up reminders,
  channel-message reminders, and their dispatch/notification delivery.
- Not here: the Reminders *view* in the web app, or general task reminders →
  `apps/web`.

## Boundaries

- Depends on: `entity_access` (ports), `email` (ports), `notification` /
  `model_notifications` (the `notify` feature), `macro_uuid`/`sqlx` (`postgres`).
- Used by: `memory`.

## Recipes

- Add a new reminder kind: `src/domain/models.rs` (model) → new
  `src/domain/<kind>/service.rs` → `src/outbound/pg_reminders_repo/<kind>.rs` →
  wire into `src/domain/service/dispatch.rs`.
- Change dispatch behavior: `src/domain/service/dispatch.rs` →
  `src/inbound/dispatch_worker.rs` → `src/outbound/sqs_dispatch_queue.rs`.

## Checks

- `cargo test -p reminders --all-features` (`SQLX_OFFLINE` unset). The
  Postgres tests sit behind the `postgres` feature; the Outlook follow-up tests
  there run the real `email` service over Postgres.

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Rules: `.agents/rules/rust/architecture.md`
