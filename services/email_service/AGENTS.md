# email_service

## What it is

Email feature: deployable service hosting Gmail sync, email send/schedule/
draft routes, calendar invitation handling, and contacts/CRM sync, behind
the gateway `/email` prefix.

## Start here

- `src/main.rs` / `src/lib.rs`: entrypoint and `run()`.
- `src/api.rs` + `src/api/context.rs`: HTTP surface and `ApiContext`.
- `src/pubsub/`: SQS pubsub workers, one module per concern — `inbox_sync`,
  `link_manager` (Gmail re-subscribe), `scheduled` (scheduled sends),
  `sfs_uploader`/`sfs_deleter` (attachment storage), `gmail_ops`, `backfill`,
  `crm_cleanup`, `worker_lifecycle`.
- `src/backfill_outbox.rs`, `src/backfill_init_service.rs`,
  `src/backfill_completion_service.rs`: Gmail history backfill orchestration.
- `src/bin/`: standalone binaries — `pubsub_workers` (the queue consumer
  process), plus one-off backfill/cleanup scripts.

## Scope

- Owns: Gmail/email API routes, email-side calendar invitation handling,
  contacts sync, and all `src/pubsub/` queue consumers listed above.
- Not here: Google Calendar sync itself → `crates/calendar_events`,
  `calendar_service`; scheduled-send and SFS-cleanup *triggering* (cron) →
  `email_scheduled_handler`, `email_sfs_delete_handler`, `email_refresh_handler`
  (this service consumes the queues they publish to).

## Recipes

- Add an email API route: `src/api/email.rs` (or `src/api/gmail.rs`,
  `src/api/calendar_invitations.rs`) → `src/api/context.rs` → `src/openapi.rs`.
- Add a pubsub consumer: new module under `src/pubsub/` → wire into
  `src/pubsub/mod.rs` and the `pubsub_workers` binary.
- Add a backfill step: `src/backfill_init_service.rs` →
  `src/backfill_completion_service.rs` → `src/backfill_outbox.rs`.

## Checks

- `cargo test -p email_service` (`SQLX_OFFLINE` unset).
- `just check` (from this directory) runs `cargo check` with `SQLX_OFFLINE=true`.
- Local SQS: `just create-localstack` / `create-queues` before running
  `pubsub_workers` locally; queue names are in the `justfile`.

## Gotchas

- Macro's own digest emails are filtered out of Signal/email notifications
  (#7039) — don't reintroduce a path that notifies on our own sends.
- Long attachment names are truncated to the DSS limit before upload (#7893);
  don't remove that truncation when touching `util/upload_attachment.rs`.
- Preserve the calendar domain's `team_ooo_changed` hint when forwarding a
  calendar refresh so unrelated invitation updates retain teammates' OOO rows.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `new-service`
