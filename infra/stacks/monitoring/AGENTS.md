# monitoring

## What it is

Org-global Datadog monitors, synthetics, and rollout dashboards. This stack is
manual and has only a prod stack, even for monitors covering both environments.

## Checks

From `infra/`:
- `bun test stacks/monitoring/monitors/notification-retention.test.ts`
- `bun run check`
- Biome on changed files.
- An authenticated `pulumi preview` must leave adopted monitors unchanged.

## Gotchas

- Read `README.md` before deployment: imported resources must be adopted first
  to avoid duplicate alerts. Never deploy without explicit approval.
- Notification retention adds nine monitors and one dashboard. Deploy DSS health
  instrumentation first; missing telemetry is deliberately an alert, not zero lag.
- Do not use native committed-offset lag for the independent notification
  consumers. Their per-instance log measurements preserve broadcast semantics.
- `notificationRetentionDashboardUrl` is a stack output, not an app route.
