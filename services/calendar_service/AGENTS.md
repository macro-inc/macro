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
- Macro's own per-inbox Google gate (`calendar_ratelimit.rs`, 300 calls per
  `REDIS_RATE_LIMIT_WINDOW_SECS` window, shared by the sync and calendar
  mutations) is not a calendar failure: the gate answers `Deferred` naming
  its window, the account round stops there, and the backfill consumer hides
  the delivery for that long (`Disposition::Defer`) so the next one resumes
  the round. `crates/calendar_events`' `AGENTS.md` has the round's rules.
- The router is mounted at both `/` and `/calendar` (`GATEWAY_PATH_PREFIX` in
  `src/api.rs`) because the gateway forwards the path unchanged.
- The HTTP API and every background worker share one tokio runtime, on a
  Fargate task of 1 vCPU (prod) or 0.5 vCPU (dev) that the Datadog agent and
  log router sidecars share (and Grafana Alloy in dev). Each worker round that
  does work runs in its own root span (`calendar.sync_scheduler`,
  `google_backfill`, `calendar.outlook_sync`, `calendar.outlook_queue_depth`,
  `calendar.projection_relay`,
  `calendar.replacement_recovery`, `recover_once`), so a
  `tokio runtime starvation detected` warning can be matched to the rounds
  running at that moment. Read its `cpu_wait_ms` first: near `delay_ms`, the
  task's threads could not get a CPU. With that wait, one constant `delay_ms`
  per task points at its quota running out, which work anywhere in the task
  (these rounds included) can cause; moving code to `spawn_blocking` would not
  help there.
- The Outlook sync runs `OUTLOOK_SYNC_LOOPS` (eight) claim loops per task,
  plus a one-minute queue-depth tick (`calendar.outlook_queue_depth`). The
  loop count is a code constant, not configuration: one item per account at a
  time keeps it safe at any count, and autoscaling to three tasks runs 24.
  Google's calendar sync runs its 25 backfill workers in the same process.
- The Outlook projection relay (`calendar.projection_relay`) claims up to
  `PROJECTION_BATCH` due revisions a round, publishes each to Kafka
  (`calendar.projection_publish`), and refreshes each inbox the batch changed
  once. A round that claims fewer waits for the next two-second poll, so a
  first import or a bulk change refreshes open clients about every two
  seconds instead of once per event. It is the only topic publish and viewer
  refresh for an Outlook event's changes, Macro writes included, so it runs
  while either
  `OUTLOOK_SYNC_ENABLED` or `OUTLOOK_WRITES_ENABLED` is on (inside
  `CALENDAR_SYNC_ENABLED`; `config::OutlookLoops`), and startup logs which
  Outlook loops the task runs.
- Reauth-required notifications ride the shared `LinkManagerQueue`, consumed by
  `email_service`; don't add a second calendar-specific reconnect notification.
- Forward `team_ooo_changed` to both inbox and teammate refresh notifications;
  sharing changes and uncertain sync results require `true`. An inbox refresh
  already refreshes its viewers' team views, so its teammate fan-out skips
  them; a sharing change also refreshes the sharer (`sharing_changed`).
- One inbox refresh is one gateway request (`calendar_events`'
  `GatewayCalendarRefresh`, composed once in `main.rs` on
  `event_broker_tracker` and awaited inline by the backfill): the inbox's
  viewers get `synced` and their teammates
  `team_sharing_changed`, so a write by a member of a large team costs one
  request, not one per teammate. A viewer whose sharing setting is `none`
  shows teammates nothing, so their inbox's changes refresh none of that
  viewer's teammates; a sharing change reaches every teammate whatever the
  new setting is.
- A Google sync nudges viewers only when it changed something
  (`GoogleBackfillRunReport::changed`): an upsert that created or rewrote a
  row, a source retired, or a possible out-of-office change. The sync that
  reads back a write made through Macro finds the row as the write left it
  and stays quiet, since the write already told everyone.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `new-service` ·
  Docs: `docs/guides/new-service.md` (uses this service as the model)

- The HTTP boundary validates optional signed agent correlation without changing existing authorization.
