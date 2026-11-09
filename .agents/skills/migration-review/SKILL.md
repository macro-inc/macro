---
name: migration-review
description: Review a database migration for locks, table rewrites, long transactions, and compatibility with the code already deployed. Use when a diff adds or changes a file under a migrations directory.
---

# Migration review

A migration runs once, against the production primary, before the new code
deploys. A statement that takes a strong lock on a large table, or waits for
one, stops every request that touches that table until it finishes. A
migration that the running code can't live with breaks that code for the
length of the deploy.

This review reads each statement, names the lock it takes and the table's
size, and checks the deployed code against the new schema. Writing a migration
is the [`sqlx-migration`](../sqlx-migration/SKILL.md) skill; the rule is CS-70
in [`rust/db.md`](../../rules/rust/db.md).

Never run a migration against a hosted dev or production database for this.

## 1. List what changed

```sh
base=$(git merge-base HEAD origin/main)
git diff --name-status "$base" -- '**/migrations/**'
```

- **`A`** new files: review every statement.
- **`M`** or **`D`** on a file that exists on `main`: `block`. A deployed
  migration is never edited or removed (SQLx checks its checksum); add a new
  one. Only a migration created on this branch may change.

For each statement, note the table, whether this PR creates that table (a new,
empty table can't block anyone), and its size from
[table sizes](../query-review/table-sizes.md). An unlisted table that already
exists on `main` is treated as large unless it is clearly one row per team or
setting.

SQLx runs each file in one transaction unless its first line is
`-- no-transaction`. Every lock a file takes is held until the file ends.

## 2. Check each statement

On an existing table:

| Statement | What it does | Safe form |
| --- | --- | --- |
| `CREATE INDEX` without `CONCURRENTLY` | Blocks writes for the whole build | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as the only statement of a `-- no-transaction` file |
| `CREATE UNIQUE INDEX`, `ADD PRIMARY KEY`, `ADD UNIQUE` | Builds an index under an exclusive lock | Build the unique index concurrently, then `ADD CONSTRAINT ... USING INDEX` in a later file |
| `ADD CONSTRAINT ... CHECK` or `FOREIGN KEY` without `NOT VALID` | Scans the table under the lock; a foreign key locks both tables | Add it `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate file |
| `VALIDATE CONSTRAINT` in the same file as the `ALTER TABLE` that added it | The scan runs while the `ALTER`'s exclusive lock is still held | Its own file |
| `ALTER COLUMN ... SET NOT NULL` | Scans the table under an exclusive lock | Add `CHECK (col IS NOT NULL) NOT VALID`, validate it in a later file, then `SET NOT NULL` |
| `ADD COLUMN ... NOT NULL` without a default | Fails on a non-empty table, and deployed writers don't set it | Add a default, or add it nullable |
| `ADD COLUMN` with a volatile default (`gen_random_uuid()`, `random()`, `clock_timestamp()`) or `GENERATED ... STORED` | Rewrites the table | Add it nullable, backfill in batches, then constrain |
| `ALTER COLUMN ... TYPE` | Rewrites the table and its indexes, except for a few widenings such as `varchar(n)` to `text` | New column, backfill, switch readers, drop the old one later |
| `UPDATE` or `DELETE` that backfills or cleans up | One long transaction: row locks, WAL, and bloat in proportion to the rows; in a file with DDL, the DDL's lock is held throughout | Keep it out of the migration: a batched job, or a query that tolerates both states. Small tables may be updated in place |
| `DROP COLUMN`, `DROP TABLE`, `RENAME`, a tighter constraint | Breaks deployed code that still uses the old shape | Staged across PRs: see [Compatible migrations](../../../docs/development/database.md#compatible-migrations) |
| `LOCK TABLE`, `TRUNCATE`, `VACUUM FULL`, `CLUSTER`, `REINDEX` without `CONCURRENTLY`, `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` | Exclusive lock for the duration | Needs a stated reason and a `lock_timeout` |
| `CREATE TRIGGER` on a busy table | Adds its function's cost to every write, and can reject deployed writers | Size the function per row; check old writers still succeed |
| `CREATE [OR REPLACE] FUNCTION` or `VIEW` used by queries | Changes the cost of every query that calls it | Run [`query-review`](../query-review/SKILL.md) on the callers |

For the whole file:

- Any `ALTER TABLE`, `DROP`, or `CREATE TRIGGER` on an existing table needs
  `SET LOCAL lock_timeout` first. Even a brief exclusive lock queues behind a
  long-running query, and every new query on the table then queues behind it.
- `CONCURRENTLY` inside a transactional file fails. A `-- no-transaction` file
  holds exactly one statement, because SQLx sends it as one batch.
- A new index on a large table also costs every write. Check it isn't already
  covered by an existing index's leading columns (CS-06).
- A statement on a table this PR creates is fine without any of the above.

## 3. Check it against the deployed code

Migrations deploy before services, and a service rollback does not roll the
schema back. With the migration applied and the old code still running:

- Does every old `INSERT` still succeed (new `NOT NULL` columns, new checks,
  new triggers, new foreign keys)?
- Does every old read and write still find its tables, columns, functions, and
  types under the old names and signatures?
- Does the old code produce rows the new constraints or the new code reject?
- If the new service is rolled back after writing new-shape rows, can the old
  code read them?

`git grep` the changed table, column, and function names in `crates/` and
`services/` on `origin/main` to find the deployed readers and writers.

## 4. Get evidence

- Apply the migration to a local database (`just crates/macro_db_client/migrate_db`,
  or a scratch database as in `query-review`). It must apply on the production
  engine version, not only the local one.
- To see the locks a transactional file takes, run it by hand and look before
  rolling back:

  ```sql
  BEGIN;
  \i crates/macro_db_client/migrations/<file>.sql
  SELECT relation::regclass, mode FROM pg_locks
  WHERE pid = pg_backend_pid() AND locktype = 'relation' AND mode LIKE '%Exclusive%';
  ROLLBACK;
  ```

  `AccessExclusiveLock` or `ShareLock` on a large existing table needs one of
  the safe forms above.
- Time on an empty local table says nothing about a rewrite or scan. Reason
  from the table's size, or seed it and time the statement.

## 5. Report

One row per statement that touches an existing table, worst first, plus one
row for compatibility:

| Severity | File | Statement | Table (size) | Lock or risk | Finding |
| --- | --- | --- | --- | --- | --- |
| block | `2026…_index_threads.sql` | `CREATE INDEX idx_threads_owner` | `email_threads` (over 100 million) | Blocks writes for the build | Use `CONCURRENTLY` in a `-- no-transaction` file |
| note | `2026…_add_settings.sql` | `CREATE TABLE crm_settings` | new | none | Safe: new table |

Severity:

- **`block`**: a rewrite, scan, or non-concurrent index build under a lock on
  a large or unlisted existing table; a backfill of a large table inside the
  migration; an edited or deleted deployed migration; a change the deployed
  code fails on.
- **`fix`**: the same on a table known to be small; DDL on an existing table
  without `lock_timeout`; a constraint validated in the file that adds it; a
  redundant index.
- **`note`**: safe; say why (new table, constant default, concurrent build).
