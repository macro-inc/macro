# monitoring

## What it is

Org-global Datadog monitors, synthetics, and rollout dashboards. This stack is
manual and has only a prod stack, even for monitors covering both environments.
Prod threshold and anomaly monitors are in `monitors/{macrodb,redis,queues,regressions,outlook-sync,routine-suggestions,agent-sessions}.ts`
(`prodMonitor()` in `prod-monitor.ts`), each file with a dashboard graphing its
monitors that their messages link to; every monitor notifies through `notify.ts`.
`dashboards/web-performance.ts` holds the web app performance dashboard with the
APM retention filter and span-based metrics it reads; it has no monitors.

## Checks

From `infra/`:
- `bun test --isolate stacks/monitoring` (routing and notification retention
  tests). `--isolate` matters: the Pulumi mock tests
  each import modules that register resources, and a shared module cache
  hides them from the second file.
- `bun run check`
- Biome on changed files.
- An authenticated `pulumi preview` may change adopted monitors only in
  `message` and `renotifyInterval`, apart from the exceptions README.md lists
  with the expected counts.

## Gotchas

- The CloudWatch-based monitors in `macrodb.ts`, `redis.ts` and `queues.ts`
  have hand-written Grafana copies in
  `infra/stacks/observability/nixos/prod-alerts.nix`. Change thresholds and windows
  in both. Grafana pages for those, so their Datadog copies use `pages: false`.
- Read `README.md` before deployment: imported resources must be adopted first
  to avoid duplicate alerts. Never deploy without explicit approval.
- Deploying needs the `goalertIntegrationKey` and `goalertNotifyIntegrationKey`
  secrets in stack config, and GoAlert (infra/stacks/observability) reachable
  at oncall.macro-internal.com.
- A prod monitor's graph on its file's dashboard repeats its metric and
  thresholds by hand; change both. `routing.test.ts` matches them by title.
  The long-running transaction monitor takes the lowest
  `postgresql.activity.xact_start_age` over 5 minutes, and its graph plots the
  same `moving_rollup(..., 300, 'min')`. A single-sample spike from
  notification-service's `LISTEN` connection fires hourly otherwise
  (docs/runbooks/macrodb.md#locks).
- End every monitor message with `notify({ pages })`, which routes only to
  GoAlert, and pass `dependsOn: goalertWebhooks`. Never mention a channel
  webhook, Slack handle or email address: GoAlert posts to the channel. Only
  `goalert-health` posts to `@webhook-macro-alert-hook` directly.
  `routing.test.ts` enforces it.
- Notification retention adds nine monitors, one dashboard and a downtime muting
  the prod missing-telemetry alarm; delete the downtime once DSS health
  instrumentation is deployed. Missing telemetry is deliberately an alert, not
  zero lag.
- Do not use native committed-offset lag for the independent notification
  consumers. Their per-instance log measurements preserve broadcast semantics.
- `notificationRetentionDashboardUrl` is a stack output, not an app route.
- `dashboards/web-performance.ts` reads span attributes set by
  `apps/web/src/observability` (the span model in
  `docs/agent-guide/observability.md`). Renaming one there silently empties
  its widgets. Span-based metric names and computes cannot be changed after
  creation; add a new metric instead.
- `monitors/whatsapp-session.ts` reads log events by `telemetry_event`; its
  header is the field contract with `services/whatsapp_session_service`.
  Renaming a field there silently turns its monitor into missing data.
- `monitors/harness-presence.ts` reads `harness_presence_disagreement` logged by
  `crates/harnesses/src/inbound/axum_router.rs`; its header is the field contract.
- `monitors/outlook-sync.ts` reads the health log, sync spans and Graph and
  token span fields email-service emits; its header is the field contract.
  It finds the Graph and token spans by `@outlook.throttle_origin` and
  `@outlook.token_cache`, not by name: Datadog renames an HTTP client span to
  `http.client.request` with its method as the resource.
- `monitors/routine-suggestions.ts` reads the `routine_suggestions.*` log
  events (`@event`) that `crates/scheduled_action` emits; its header is the
  field contract. Its failure monitor does not page while suggestions are
  behind their flag.
- `monitors/calls.ts` matches the text of the `voip push: SNS delivery failed`
  log in `crates/notification/src/domain/service/voip.rs` and the
  `PushEndpointUnavailable` message. Rewording either silently breaks it.
- Agent session panels (`monitors/agent-sessions.ts`) read span-based metrics
  (`datadog.SpansMetric`): custom spans produce no trace metrics, and span
  queries see only indexed spans. A new span field charted there needs its own
  span-based metric, and only counts from the deploy that creates it. Its tool
  metrics count spans with `gen_ai.conversation.id`, one per session tool call;
  `execute_tool*` alone double-counts tools reached through MCP.
