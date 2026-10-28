# monitoring

## What it is

Org-global Datadog monitors, synthetics, and rollout dashboards. This stack is
manual and has only a prod stack, even for monitors covering both environments.
Threshold rules come from the shared catalog in `infra/alerts/rules.json`
(`monitors/catalog.ts`); every monitor notifies through `notify.ts`.

## Checks

From `infra/`:
- `bun test --isolate stacks/monitoring alerts` (routing, catalog and
  notification retention tests). `--isolate` matters: the Pulumi mock tests
  each import modules that register resources, and a shared module cache
  hides them from the second file.
- `bun run check`
- Biome on changed files.
- An authenticated `pulumi preview` may change adopted monitors only in
  `message` and `renotifyInterval`; README.md lists the expected counts.

## Gotchas

- Read `README.md` before deployment: imported resources must be adopted first
  to avoid duplicate alerts. Never deploy without explicit approval.
- Deploying needs the `goalertIntegrationKey` secret in stack config, and
  GoAlert (infra/stacks/observability) reachable at oncall.macro-internal.com.
- Never mention a Slack handle or email address in a monitor message; end it
  with `notify({ pages })`. `routing.test.ts` enforces it.
- Notification retention adds nine monitors and one dashboard. Deploy DSS health
  instrumentation first; missing telemetry is deliberately an alert, not zero lag.
- Do not use native committed-offset lag for the independent notification
  consumers. Their per-instance log measurements preserve broadcast semantics.
- `notificationRetentionDashboardUrl` is a stack output, not an app route.
- `monitors/whatsapp-session.ts` reads log events by `telemetry_event`; its
  header is the field contract with `services/whatsapp_session_service`.
  Renaming a field there silently turns its monitor into missing data.
- `monitors/calls.ts` matches the text of the `voip push: SNS delivery failed`
  log in `crates/notification/src/domain/service/voip.rs` and the
  `PushEndpointUnavailable` message. Rewording either silently breaks it.
