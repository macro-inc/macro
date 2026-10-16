# reminders

## What it is

Part of the Email feature. Private email snoozes: durable inbox
restoration, scheduled dispatch, and notification delivery, plus email
follow-up reminders.

## Start here

- `src/domain.rs` module list: `email_collection` (snooze/restore) and
  `email_followup` (follow-up reminders), each with its own `service.rs`.
- `src/domain/service/dispatch.rs`: the recurring dispatch loop shared by both.
- `src/inbound/dispatch_worker.rs`: the queue worker entry point (`dispatch` feature).
- `src/outbound/pg_reminders_repo.rs`: Postgres repo, split by sub-area.

## Scope

- Owns: email snooze scheduling/restoration, email follow-up reminders, and
  their dispatch/notification delivery.
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

- `cargo test -p reminders` (`SQLX_OFFLINE` unset).

## Related

- Skill: `cloud-storage-hexagonal-architecture` · Rules: `.agents/rules/rust/architecture.md`
