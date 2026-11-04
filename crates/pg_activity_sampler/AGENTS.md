# pg_activity_sampler

## What it is

MacroDB observability: once a minute, one replica of the hosting service reads
`pg_stat_activity` and logs every session whose transaction has been open past
a threshold, with its `application_name`, state, ages, wait event and query.
`document_storage_service` hosts it (60 s interval, 300 s threshold).

## Start here

- `src/domain.rs`: `run` loop, `LongTransaction`, and the
  `pg_long_transaction` log event (`telemetry_event` field).
- `src/outbound.rs`: leader election and the `pg_stat_activity` query.

## Scope

- Owns: finding and logging long-open transactions.
- Not here: alerting → `infra/stacks/monitoring/monitors/macrodb.ts`; naming
  sessions → each service sets `application_name` on its pool
  (ast-grep `rust-pg-pool-application-name`).

## Checks

- `cargo test -p pg_activity_sampler` (`SQLX_OFFLINE` unset; needs Postgres).

## Gotchas

- Leadership is the session advisory lock
  `hashtextextended('pg_activity_sampler', 0)` on the leader's own connection;
  followers connect, fail the lock and disconnect each tick. Never take the lock
  on a pooled connection: returning it to the pool keeps the lock forever.
- The sampler only reads; it never opens a transaction or sets timeouts.
  Sessions of other database roles show `<insufficient privilege>` as their
  query unless the role has `pg_read_all_stats`.
- Log field names are what Datadog searches by; renaming one breaks saved
  log queries.
