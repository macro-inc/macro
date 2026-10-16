# notification_retention_handler

## What it is

Internal scheduled notification cleanup. The owning notification domain enforces
30-day retention and bounded transactions; this binary only composes it for Lambda.

## Start here

- `src/main.rs`: one-connection pool, retained telemetry provider, post-invocation
  flush. Close handler spans before flushing; never shut down warm providers.
- `src/handler.rs`: explicit dry-run default, invocation deadline and request ID.
- `infra/stacks/notification-service/retention.ts`: disabled schedule, pinned
  Datadog extension, scoped key access and nonduplicated log forwarding.

## Checks

- `cargo test -p notification_retention_handler` (`SQLX_OFFLINE` unset).
- `cargo test -p notification -p macro_entrypoint` for policy and flush behavior.
- From `infra/`: `bun test stacks/notification-service/retention.test.ts`.

## Gotchas

- `{}` is read-only; `{"dry_run":false}` permanently deletes hosted data.
- Telemetry failure preserves the operation result; it must not trigger a retry
  of already-committed deletion. Flush time comes from reserved handler headroom.
- Unit tests cannot prove the deployed extension exported traces. Verify an
  explicitly approved dry run in Datadog before production cleanup.
- The schedule stays disabled until the rollout is explicitly approved.

## Related

- `docs/runbooks/notification-retention.md`
- `.agents/rules/observability.md`
