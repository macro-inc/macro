# Email service infrastructure

Owns the email API, pub/sub consumers, focus worker, scheduled handlers, queues,
attachment storage, and Redis. Runtime code lives in `services/email_service`.

## Worker capacity

- Set `pubsub_workers_desired_count`, `pubsub_workers_min_capacity`, and
  `pubsub_workers_max_capacity` in each `Pulumi.<stack>.yaml`. They control ECS
  tasks, must be positive integers, and must satisfy min <= desired <= max.
- Production is pinned to 8 tasks for backfill recovery; dev retains a desired
  count of 1 and autoscaling bounds of 1–2. Lower the production values after
  recovery. There is no expiry or automatic scale-down when the queue empties.
- Keep desired count and autoscaling bounds in sync when changing capacity.
  Deployments apply configuration changes but do not refresh Pulumi state;
  manual ECS adjustments can persist when Pulumi sees no change. Refresh state
  before reconciling out-of-band drift.
- Per-task `BACKFILL_QUEUE_WORKERS` comes from the email service's Doppler config
  through `APP_SECRETS_JSON`. At 24 per task, 8 tasks provide 192 backfill
  workers at steady state; rolling deployments can temporarily overlap old and
  new tasks. The legacy `backfill_queue_workers` Pulumi key is not wired into
  the task's runtime configuration.
- These tasks also consume inbox sync and Gmail operation queues. Changing task
  count scales their consumers and database connection pools as well.

## CRM consent rollout ordering

The automatic deploy-all workflow waits for this stack's pub/sub worker service
and verifies its `crmBackfillConsumer` output before deploying DSS. Export the
TaskDefinition resource created by this update and the immutable image URI, never
the current live service revision (which can be an old circuit-breaker rollback).
The verification includes actual termination of old tasks, not merely desired
STOPPED status. Keep pub/sub `continueBeforeSteadyState: false`; other ECS defaults
remain unchanged. Standalone stack deployments bypass this cross-service order.

## Checks

- `bun run --cwd infra check` from the repository root.
- `just check` from the repository root.

## Related

- [Infrastructure guide](../../../docs/development/infrastructure.md)
- [Pulumi rules](../../../.agents/rules/infra/pulumi.md)
- [Configuration rules](../../../.agents/rules/config-and-service-urls.md)
