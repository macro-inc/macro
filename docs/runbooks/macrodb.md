# MacroDB alerts

Runbook for the `macro-db-prod` and `macro-db-prod-read-replica` monitors in
[`monitors/macrodb.ts`](../../infra/stacks/monitoring/monitors/macrodb.ts). Both instances are
`db.m9g.2xlarge`: 8 vCPU, about 30 GB of memory, `max_connections` 3,439.

Start in three places:

1. **Performance Insights** for the instance (RDS console → the instance →
   Monitoring → Database load). Group by waits, then by SQL, to see what the
   active sessions are doing.
2. **Datadog Database Monitoring** for `macro-db-prod` (Query Metrics, Query
   Samples, and the blocking queries view).
3. **Recent deploys and queue backlogs.** Most overloads have started with a
   deploy, a backfill, or a queue draining all at once. Check the ECS service
   events and the SQS monitors in the same window.

## Memory

Freeable memory and swap alerts. Every Postgres backend keeps several MB of
private memory, about 14 MB per connection under prod load, so memory falls as
connections rise. The OS page cache shrinks first; once it is gone the
instance swaps and every query slows.

- Check `aws.rds.database_connections` against the same window. If connections
  climbed, find which services added them (see [Connections](#connections)).
- Check swap (`aws.rds.swap_usage`). Sustained swap above a few GB means the
  instance is out of memory, not just low on cache.
- Levers: lower the pool size of the service that grew; pause backfills; as a
  last resort fail over or resize the instance (a resize restarts it).

## Load

Database load (average active sessions) relative to vCPUs, CPU, and disk read
latency. Load above the vCPU count means sessions are queueing for CPU, locks
or IO.

- In Performance Insights, the top wait event says which: `CPU`, `Lock:*` /
  `LWLock:*`, or `IO:*`.
- If lock waits dominate, go to [Locks](#locks).
- If one query dominates CPU, find its caller from the query sample's
  application name and the APM span with the same statement.
- Levers: pause the backfill or worker driving the load; roll back the deploy
  that introduced the query; add the missing index in a follow-up.

## Connections

Connection count on the primary or replica. Each ECS task opens its own pool,
so connections scale with task count times pool size.

- Group `postgresql.connections` (Database Monitoring) or Performance Insights
  sessions by application or user to see which service holds them.
- Check whether a service scaled out (`aws.ecs.service.running`) or a pool
  setting changed in a recent deploy.
- Levers: lower that service's pool maximum or task count. RDS Proxy is not a
  quick fix: moving a service onto it has caused pool timeouts before.

## Replica lag

The read replica is behind the primary. GraphQL Soup reads go to the replica,
so users see stale lists and items they just created go missing.

- Check primary write volume and WAL (`aws.rds.transaction_logs_generation`)
  and replica CPU and IO. Lag usually follows a write burst on the primary or a
  long query on the replica holding back replay.
- Look for long-running queries on the replica in Database Monitoring.
- Levers: stop the write burst (often a backfill); cancel the long replica
  query.

## Storage

Free storage space, now or forecast to run low within a week.

- Compare `aws.rds.free_storage_space` with
  `aws.rds.transaction_logs_disk_usage` and
  `aws.rds.replication_slot_disk_usage`: WAL held by a replication slot
  grows without bound.
- Otherwise find the tables that grew (`pg_total_relation_size` on the largest
  relations) and what started writing to them.
- Levers: drop an abandoned replication slot; stop the writer; increase
  allocated storage (online, but only once every six hours).

## Locks

Connections blocked on locks, or a transaction open for a long time.

- In Database Monitoring's blocking queries view, find the blocking session and
  its query. Advisory locks (`pg_advisory_xact_lock`) and tuple locks from
  concurrent updates of the same rows have caused past overloads.
- A long open transaction holds its locks and stops vacuum. Find it in
  `pg_stat_activity` (`xact_start`, `state = 'idle in transaction'`).
- Levers: cancel (`pg_cancel_backend`) or terminate (`pg_terminate_backend`)
  the blocking session once you know what it is; stop the job that keeps
  starting new ones.
