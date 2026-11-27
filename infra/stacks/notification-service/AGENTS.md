# notification-service stack

## What it is

ECS notification delivery, queues/mobile platforms, and the separately scheduled
notification-retention Lambda. Runtime business policy lives in Rust.

## Checks

From `infra/`:
- `bun test stacks/notification-service/retention.test.ts`
- `bun run check`
- Run `biome ci --changed --no-errors-on-unmatched --error-on-warnings` inside
  the Nix shell to match CI; the Bun-installed formatter can differ.

## Gotchas

- Dev and prod configs enable hourly 30-day retention in deletion mode.
  Deploying either stack activates cleanup; deployment still needs
  explicit approval and the checks in `docs/runbooks/notification-retention.md`.
- Keep the disabled/dry-run defaults for missing config and empty manual events.
- The retention function needs its pinned x86_64 Datadog extension to receive
  gRPC OTLP; the ECS sidecar default alone does not work in Lambda.
- Pass the existing Datadog key ARN, not its value, and scope the role to that key.
- Where `grafanaTelemetryEnabled`, the function also runs the pinned
  OpenTelemetry Collector layer on `127.0.0.1:14317` for Grafana's copy of its
  spans. Its config is the `GRAFANA_COLLECTOR_CONFIG` env var, with a reference
  to the ingest token's ARN, never the token. The collector failing to start
  fails the function's init.
- Extension log shipping is off: the shared Lambda helper already forwards
  CloudWatch logs through Firehose. Monitoring resources deploy separately from
  `infra/stacks/monitoring`, not automatically with this service.
