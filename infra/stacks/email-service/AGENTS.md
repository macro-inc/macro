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

## Queues

- `email-service-crm-population` is a high-throughput FIFO queue whose
  message group is the mailbox, so SQS hands out one CRM population per
  mailbox at a time. Workers back off by hiding a message, and each back-off
  costs a receive on the next delivery: its redrive limit of 100 only catches
  a message that never settles. Its 10 s delivery delay is a margin for a
  backfilled thread to commit before its contacts are read. A message held in
  back-off stays at the head of its mailbox's group, so the oldest-message
  alarm (6 h) can fire for one mailbox stuck that long, not only for a
  backlog nobody receives. Deploy the queue before any `pubsub_workers`
  release that sends to it.
- `email-service-refresh` is the link manager's interactive queue and
  `email-service-link-maintenance` its maintenance queue, both 300 s visibility
  and one consumer per task. The refresh handler sends only to the maintenance
  queue but keeps send rights on both, so a handler released before the split
  still works mid-rollout. Both are created in the same stack update that
  ships their consumers, so neither waits on a separate deploy.

## Checks

- `bun run --cwd infra check` from the repository root.
- `just check` from the repository root.

## Related

- [Infrastructure guide](../../../docs/development/infrastructure.md)
- [Pulumi rules](../../../.agents/rules/infra/pulumi.md)
- [Configuration rules](../../../.agents/rules/config-and-service-urls.md)
