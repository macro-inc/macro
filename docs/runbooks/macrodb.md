# MacroDB alerts

Runbook for the `macro-db-prod` and `macro-db-prod-read-replica` monitors in
[`monitors/macrodb.ts`](../../infra/stacks/monitoring/monitors/macrodb.ts), and the
cloud-storage-service pool monitor in
[`monitors/storage-pool.ts`](../../infra/stacks/monitoring/monitors/storage-pool.ts). Both instances are
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

## I/O credits

Instance I/O credits (`EBSIOBalance%`) are draining on one instance. Three
limits are easy to confuse:

- **Instance I/O credits.** The instance class sustains 6,000 read plus write
  IOPS and bursts above that by spending `EBSIOBalance%`. This alert. At zero
  the instance is held to the baseline whatever the volume allows.
- **Provisioned storage IOPS.** The volume allows 12,000. It is not the limit
  here, and raising it does not help.
- **CPU credits.** Burstable classes only (`CPUCreditBalance`); these
  instances have none. CPU stays moderate through an I/O credit drain.

On 2026-10-27 the replica's balance fell from 99% to zero in five and a half
hours. Once at zero, IOPS sat flat at 6,000, disk queue depth and read latency
rose tenfold, active sessions reached 65 per vCPU and the replica fell 30
minutes behind for about two hours. The warning (70%) leaves about four hours
at that rate and the critical (40%) about two and a half.

- On the MacroDB alerts dashboard, check read plus write IOPS against the
  6,000 line. A nightly burst at about 06:00 UTC crosses it for an hour and
  costs a few percent; a drain is hours above it.
- In Performance Insights, `IO:DataFileRead` and `IO:BufFileRead` waits name
  the SQL doing the reads. Bytes rather than operations would show in
  `EBSByteBalance%`, which has not moved in any incident.
- Levers: cancel or bound the query doing the reads; move its callers off the
  replica while it recovers (the balance refills at about 12% an hour once
  IOPS are back under the baseline); a larger instance class raises the
  baseline, and a resize restarts the instance.

## Pool waits

cloud-storage-service took long to hand out a connection from one of its sqlx
pools (`primary`, or `readonly` for the replica). The alert names the pool.
Each task measures this by acquiring one connection per pool every second.
This is time queued inside the service before any SQL runs; slow SQL shows in
the `sqlx::query` slow-statement logs and Database Monitoring instead. Open the
[Search and database saturation](../../infra/stacks/monitoring/monitors/storage-pool.ts)
dashboard, linked from the alert, and decide which of two causes it is:

- **The database is slow**, so connections come back late and the pool is the
  queue. Connections in use sit at the pool maximum, active sessions per vCPU
  on that pool's instance are above 1 or its I/O credits are low, and task CPU
  is normal or low. On 2026-11-09 the primary ran at 11 sessions per
  vCPU for an hour while task CPU fell to 2%. Go to [Load](#load),
  [Locks](#locks) or [I/O credits](#io-credits).
- **The service is starved**, so it cannot get to the connections it has.
  Connections in use stay below the pool maximum, the busiest task's CPU is
  near 100% and the database is idle. On 2026-11-13 in dev one task sat at 95-99% CPU
  with one active query on the database. Find what is burning CPU (a large
  response, a retry loop); more tasks help, a larger pool does not.

If connections in use sit at the pool maximum and the database is idle, a
caller is holding connections across slow work; find the longest
`soup.pool.acquire` and request spans in APM. Probes that time out read the
pool's acquire timeout, so a flat line at that value means nothing is getting
a connection at all.

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
- A long open transaction holds its locks and stops vacuum. The long-running
  transaction alert fires once the oldest transaction has stayed old for five
  minutes. Find it and its SQL in `pg_stat_activity` (`xact_start`,
  `state = 'idle in transaction'`) or Database Monitoring.
- A single sample of `postgresql.activity.xact_start_age` as old as the
  newest `notification-service` task, at about :09 past the hour, is not a
  transaction. notification-service's `LISTEN` connection (no
  `application_name`) briefly runs a server-side transaction while it delivers
  the `NOTIFY` burst from the hourly notification retention sweep. That
  transaction's `xact_start` is the connection's last statement, its `LISTEN`
  at task start. A fresh `backend_xmin` (thousands of transaction IDs old,
  not millions) shows it is not holding back vacuum.
- Levers: cancel (`pg_cancel_backend`) or terminate (`pg_terminate_backend`)
  the blocking session once you know what it is; stop the job that keeps
  starting new ones.
