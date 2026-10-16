# notification-service stack

## What it is

ECS notification delivery, queues/mobile platforms, and the separately scheduled
notification-retention Lambda. Runtime business policy lives in Rust.

## Checks

From `infra/`:
- `bun test stacks/notification-service/retention.test.ts`
- `bun run check`
- `bunx biome check stacks/notification-service`

## Gotchas

- Keep retention disabled/dry-run until explicitly approved. Deployment does not
  authorize deletion; `docs/runbooks/notification-retention.md` owns rollout.
- The retention function needs its pinned x86_64 Datadog extension to receive
  gRPC OTLP; the ECS sidecar default alone does not work in Lambda.
- Pass the existing Datadog key ARN, not its value, and scope the role to that key.
- Extension log shipping is off: the shared Lambda helper already forwards
  CloudWatch logs through Firehose. Monitoring resources deploy separately from
  `infra/stacks/monitoring`, not automatically with this service.
