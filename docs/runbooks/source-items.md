# source_items: enabling the projection

`source_items` is the listing projection soup can read flat pages from: one row
per (source, document/chat/project), kept current by triggers on
`entity_access`, `"Document"`, `"Chat"`, `"Project"` and `document_sub_type`.
`crates/soup/SOURCE_ITEMS_ROLLOUT.md` describes how it works; this runbook is
the order of operations. Each step is separately reversible, and nothing reads
the table until step 5. One deploy of this PR runs steps 1 and 2 back to back
(the migrations run in order); to space them out, deploy the index migrations
first.

| Step | Turns on | Costs | Undo |
| --- | --- | --- | --- |
| 0. Base migration (#7462) | nothing: table, read index, functions | none | none needed |
| 1. Read indexes (this PR, first two migrations) | `"Document"(owner, "updatedAt" DESC, id DESC)`, `"UserHistory"("userId", "itemType", "updatedAt" DESC, "itemId" DESC)` | one index build each, then one index insert per write | `DROP INDEX CONCURRENTLY` |
| 2. Enable migration (this PR, third) | triggers: every write maintains the rows of the items it touches | about +2 ms per item write, more WAL, commit-time locks | `SELECT source_items_remove_triggers()` (disables them) |
| 3. Backfill | rows for items untouched since step 2 | 10–40 min at production scale, load and WAL | rerun; or remove triggers and `TRUNCATE source_items` |
| 4. Audit | nothing | one long read snapshot | none |
| 5. Read switch (not wired yet) | soup reads `source_items` | none on writes | switch off, restart |

## Before you start

- Check `source_items_read` (from the base migration) has `pg_index.indisvalid`
  true.
- Confirm no logical replication subscribes to MacroDB (RDS Blue/Green, DMS).
  The triggers are `ENABLE ALWAYS`, so they fire on a subscriber's apply worker
  too and conflict with replicated `source_items` rows. Run Blue/Green with the
  triggers removed (step 2's undo), then backfill and audit again.
- Pick a quiet window: step 2 locks the five tables briefly, step 3 adds write
  load for minutes.
- Note today's baselines to compare against: write latency on the five tables
  (Datadog APM `document_storage_service` save/create/share spans), RDS
  `ReplicaLag`, `WriteIOPS`, `TransactionLogsGeneration`, and for the RDS Proxy
  clients (`deleted-item-poller`, `document-text-extractor`)
  `DatabaseConnectionsCurrentlySessionPinned`.

## 1. Build the read indexes

Two `CREATE INDEX CONCURRENTLY` migrations, one statement each, outside a
transaction: they take SHARE UPDATE EXCLUSIVE, so reads and writes continue.
The `"Document"` index took 10.6 s for 5M documents on the synthetic copy
(expect about 35 s at 15M); the `"UserHistory"` one scales with its rows.
Only projected reads use them: the owner driver and view-time sorts.

Watch: the build in `pg_stat_progress_create_index`, and IO. Afterwards check
`pg_index.indisvalid` for both. An interrupted build leaves an invalid index
that `IF NOT EXISTS` skips: `DROP INDEX CONCURRENTLY` it outside a transaction
and rerun its statement.

Cost from then on: one more index insert per document save and per history
upsert, and a view's history upsert becomes a non-HOT update (6 µs, 4%, on the
synthetic copy). One main-path plan changes: a "completed by me" task filter
for one user measured 8 ms -> 56 ms.

Undo: `DROP INDEX CONCURRENTLY idx_document_owner_updated_live;` and
`DROP INDEX CONCURRENTLY idx_user_history_user_type_updated;`, outside a
transaction. Their migrations stay recorded as applied, so restoring them
takes a new migration.

## 2. Install the triggers

Ships as a migration that calls `source_items_install_triggers()` under
`SET LOCAL lock_timeout = '2s'`. The function takes SHARE ROW EXCLUSIVE on all
five tables in one `LOCK TABLE` statement and creates the triggers with
`CREATE OR REPLACE TRIGGER`, so it waits for writers but never for readers.
`LOCK TABLE` locks the tables one after another and the timeout bounds each
wait, so writes to a table it already holds can wait for up to four more
timeouts (8 s); it either gets every lock or fails and rolls back, and a failed
deploy is safe to retry. It installs 20 triggers and
holds the locks only for those catalog changes (27 ms on the synthetic copy
under write load). It also sets autovacuum on `source_items` to 2% of its rows.

To run it by hand instead (e.g. to retry outside a deploy):

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT source_items_install_triggers();
COMMIT;
```

Watch for 15 minutes:

- item and grant write latency: on the synthetic copy a save went 0.8 -> 2.8 ms
  and a create 1.4 -> 4.8 ms (4 clients, overloaded box), WAL per save
  1.5 -> 2.6 KB. A sustained doubling of p99 against the baseline is a reason
  to undo.
- `pg_stat_activity` waits on `source_items_mutex` (`wait_event_type = 'Lock'`,
  `wait_event = 'transactionid'` or `'tuple'`): normal is none or brief.
- errors with SQLSTATE `25000` (a writer under REPEATABLE READ or SERIALIZABLE)
  or deadlocks at COMMIT in service logs.
- proxy session pinning for the poller and the text extractor: the first write
  of each session creates temporary tables.

Undo: `SELECT source_items_remove_triggers();` under `SET LOCAL lock_timeout = '2s'`.
It disables the triggers, with the same SHARE ROW EXCLUSIVE locks as install, so
readers keep going. Writes return to their old cost at once. Reads stop trusting
the table in the same commit (`source_items_exact()` turns false), so even with
the read switch on soup goes back to the item tables. To re-enable, first turn
the read switch off and restart, then repeat steps 2–4, and turn
reads back on (step 5) only after the audits pass: the backfill alone makes
`source_items_exact()` true again, before any audit has run.

Writers that change many items in one transaction (migrations, scripts,
`UPDATE "Document" ...` over many rows, a large team share) now rewrite those
items' rows at commit while holding their buckets. Batch such changes in small
committed chunks while the triggers are on, and remove the triggers first for a
one-off mass update, then backfill.

DDL that takes ACCESS EXCLUSIVE on any of the five tables (a non-concurrent
index, `ALTER TABLE`, `VACUUM FULL`, pg_repack's swap) now also stalls the
commits of writers to the other four, because each commit takes ACCESS SHARE on
all five. Give such migrations a short `lock_timeout`.

## 3. Backfill

Against the primary, with `DATABASE_URL` from the environment's normal secret
handling:

```sh
cargo run --release -p source_items --features cli --bin source_items -- backfill
```

When it finishes with the triggers on throughout, it records the table as
backfilled, and only then do projected reads use it; otherwise it exits non-zero
and reads keep using the item tables. It rewrites every document, chat and project in 500-item batches through
`source_items_refresh`, which locks each batch's buckets as a commit does, so it
runs safely alongside writers. Each batch has a 200 ms lock timeout and retries
after a second; 30 failures on one batch stop the run. It does not keep a
cursor: an interrupted run restarts from the first id, which is safe (each
batch is idempotent) but repeats the work.

On the synthetic copy (5.9M items, 6.8M grants) it took 7.5 min alone and
17 min beside steady writes on an overloaded box, slowest batch 0.7 s; a
quieter run at production scale (12.6M items) took 9 min. Expect 10–40 min.
It writes about one row per grant (2.8 GB for 6.8M rows here) and the first
run creates one `source_items_mutex` row per item (347 MB for 5.7M here, about
1 GB at production scale). Writers to the inputs slowed by about 1 ms more
while it ran.

Watch: `ReplicaLag` (pause by stopping the process if it climbs past a few
seconds; resume by rerunning), CPU and `WriteIOPS`, and the same write
latencies as step 2. Each batch logs `backfilled source items` with its cursor.

Undo: stop the process. Rows written so far are correct; the rest stay missing,
which only matters once reads are on.

## 4. Audit

```sh
cargo run --release -p source_items --features cli --bin source_items -- audit
```

Run it on the primary and on every replica soup reads from. It compares the
whole table with its inputs in one read-only snapshot (63 s for 6.8M rows on
the synthetic copy) and exits non-zero unless both mismatch counts are zero. The long
snapshot holds back vacuum on the primary and can be cancelled by hot-standby
conflicts on a replica; rerun it if so.

A non-zero count: rerun the backfill, then the audit. If it stays non-zero,
something writes `source_items` outside the triggers or the triggers were
removed; do not enable reads.

## 5. Enable reads

No service reads `source_items` yet: soup reads it only when its repository is
built with `PgSoupRepo::with_source_items_enabled(true)`, and only soup's tests
call that. Turning reads on first needs a change that wires it to a typed
config value (`maybe_env_vars!`, CS-14) with Doppler keys in every config
(CS-18). Then turn it on for one document storage canary and restart it.
Compare soup list latency (`soup.sql.fetch_decode` spans,
`soup.source_items.bound` for routing) and error rates with the other tasks for
a day, then roll out to the rest.

Undo: turn the switch off and restart. The triggers keep running;
remove them (step 2's undo) to drop the write cost as well. Removing them alone
also stops projected reads at once, without a restart: reads fail closed.
