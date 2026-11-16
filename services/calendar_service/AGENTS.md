# calendar_service

## What it is

Calendar feature: deployable service hosting Google Calendar sync,
user-initiated calendar mutations, and calendar scheduling behind the
gateway `/calendar` prefix.

## Start here

- `src/main.rs`: composition root — config, db/redis, event broker, workers, router.
- `src/api.rs` + `src/api/context.rs`: HTTP surface and shared `ApiContext`.
- `src/calendar_backfill.rs` + `src/backfill_queue.rs`: SQS backfill consumer.
- `src/calendar_outbox.rs`: sync scheduler and outbox drain loop.

## Scope

- Owns: the Google Calendar push webhook, calendar mutation routes, calendar
  sync scheduling/outbox, and the backfill queue worker.
- Not here: calendar domain logic and the Postgres/Google adapters →
  `crates/calendar_events`, `crates/calendar_scheduling`.

## Boundaries

- Depends on: `calendar_events`, `calendar_scheduling` (domain crates owning
  the Postgres/Google adapters), `connection_gateway_client`,
  `authentication_service_client`, `macro_authorization`, `macro_service_urls`.
- Used by: the web app and SDK calendar clients, through the gateway.

## Recipes

- Add a mutation route: `crates/calendar_events` (domain + Postgres adapter) →
  `src/api/context.rs` → `src/api.rs` (router) → `src/openapi.rs`.
- Add a backfill step: `src/calendar_backfill.rs` → `src/calendar_backfill_adapters.rs`
  → `src/backfill_queue.rs`.
- Add a config value: `src/config.rs` → Doppler (`calendar-service` project) →
  `tooling/xtask/crates/xtask_local/src/local/local_env.rs` for `--no-doppler`.

## Checks

- `cargo test -p calendar_service` (`SQLX_OFFLINE` unset).
- `curl http://localhost:8088/health` after `just run_local`.

- Run it without a Google account: `crates/gmail_emulator` serves the
  Calendar API and pushes to `/notifications`; its `AGENTS.md` lists the
  overrides. A local stack with no Google client sets them by itself.

## Gotchas

- The API's server spans come from `macro_tower_layers` (`api::traced`).
  tower-http's default `TraceLayer` span is DEBUG, below the exporter's INFO
  filter, so an API wrapped in it sends no server spans.

- A calendar whose sync fails is isolated: the job completes, the calendar
  keeps its error and failure count, and nothing retries it before the next
  push or the five-minute poll, whatever `Retry-After` Google sent.
- The router is mounted at both `/` and `/calendar` (`GATEWAY_PATH_PREFIX` in
  `src/api.rs`) because the gateway forwards the path unchanged.
- The HTTP API and every background worker share one tokio runtime, on a
  Fargate task of 0.5 vCPU (prod) or 0.25 vCPU (dev) that the Datadog agent
  and log router sidecars share. Each worker round that does work runs in its
  own root span (`calendar.sync_scheduler`, `google_backfill`,
  `calendar.outlook_sync`, `calendar.projection_relay`,
  `calendar.replacement_recovery`, `recover_once`), so a
  `tokio runtime starvation detected` warning can be matched to the rounds
  running at that moment. Read its `cpu_wait_ms` first: near `delay_ms`, the
  task's threads could not get a CPU. With that wait, one constant `delay_ms`
  per task points at its quota running out, which work anywhere in the task
  (these rounds included) can cause; moving code to `spawn_blocking` would not
  help there.
- Reauth-required notifications ride the shared `LinkManagerQueue`, consumed by
  `email_service`; don't add a second calendar-specific reconnect notification.
- Forward `team_ooo_changed` to both inbox and teammate refresh notifications;
  sharing changes and uncertain sync results require `true`. An inbox refresh
  already refreshes its viewers' team views, so its teammate fan-out skips
  them; a sharing change also refreshes the sharer (`notify_sharers`).

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `new-service` ·
  Docs: `docs/guides/new-service.md` (uses this service as the model)

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
