# resources

## What it is

Shared Pulumi AWS building blocks used by service stacks: gateway target groups,
queues, storage, ECS defaults, alarms, and telemetry sidecars.

## Start here

- `src/index.ts`: exported components and helpers.
- `src/resources/datadog.ts`: ECS telemetry sidecars and the existing Datadog key.
  `DATADOG_API_KEY_SECRET_ARN` lets extensions retrieve that same key without
  copying its value into runtime environment variables.

## Checks

- From `infra/`: `bun run check` and Biome on changed files.
- Changes to Datadog key wiring: run
  `bun test stacks/notification-service/retention.test.ts`.

## Gotchas

- Do not create a parallel Datadog secret. Grant only the specific secret ARN
  to consumers that fetch the key themselves.
- Reuse the gateway/Doppler patterns in `docs/development/infrastructure.md`;
  some older exported helpers remain for legacy stacks, not new services.
