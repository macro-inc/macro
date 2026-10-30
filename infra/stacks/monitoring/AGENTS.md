# monitoring

## What it is

Org-global Datadog monitors, synthetics, and rollout dashboards. This stack is
manual and has only a prod stack, even for monitors covering both environments.
Prod threshold and anomaly monitors are in `monitors/{macrodb,redis,queues,regressions}.ts`
(`prodMonitor()` in `prod-monitor.ts`), each file with a dashboard graphing its
monitors that their messages link to; every monitor notifies through `notify.ts`.

## Checks

From `infra/`:
- `bun test --isolate stacks/monitoring` (routing and notification retention
  tests). `--isolate` matters: the Pulumi mock tests
  each import modules that register resources, and a shared module cache
  hides them from the second file.
- `bun run check`
- Biome on changed files.
- An authenticated `pulumi preview` may change adopted monitors only in
  `message` and `renotifyInterval`; README.md lists the expected counts.

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
- `monitors/whatsapp-session.ts` reads log events by `telemetry_event`; its
  header is the field contract with `services/whatsapp_session_service`.
  Renaming a field there silently turns its monitor into missing data.
- `monitors/calls.ts` matches the text of the `voip push: SNS delivery failed`
  log in `crates/notification/src/domain/service/voip.rs` and the
  `PushEndpointUnavailable` message. Rewording either silently breaks it.
