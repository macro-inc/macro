# Measuring a query plan

How to run a query through `EXPLAIN (ANALYZE, BUFFERS)` on a local database
seeded to production size, and how to read the result. The
[`query-writing`](../query-writing/SKILL.md) skill requires this for every
query before it is committed; the [`query-review`](../query-review/SKILL.md)
skill uses it when it measures a query itself.

Use only a local server. Never connect to a hosted dev or production database,
and never seed the database the app or the tests use.

## 1. Create a scratch database

Create it on the local server, migrate it, and drop it when done:

```sh
createdb -h localhost query_plans && sqlx migrate run --source crates/macro_db_client/migrations \
  --database-url postgres://<local-user>@localhost/query_plans
```

Production runs the Postgres version in
`infra/stacks/macrodb/Pulumi.prod.yaml`, which is older than the local default.
Note the local version (`SHOW server_version`) with the result; a plan that
relies on a newer planner feature has to be checked on the older version.

## 2. Get the exact SQL

- A `query!`: the SQL text is in its `.sqlx` entry after `just prepare_db`, or
  copy it from the source. Keep the `$1` placeholders.
- Assembled SQL: run the test that executes the shape against a server started
  with `log_statement = all` and copy the statement and its parameters from the
  log, or print `QueryBuilder::sql()` in the test. Don't retype it from the
  builder code. Measure every shape the code can produce that differs in its
  joins or filters, not only the default one.

## 3. Seed to production size

Seed with `INSERT ... SELECT FROM generate_series(...)`, then `ANALYZE`:

- **The largest tenant** the query can run for, at the size in
  [table sizes](table-sizes.md), with the skew that matters: one mailbox with
  tens of thousands of threads, a filter value that matches a few hundred of
  them and another that matches almost all.
- **Background rows** for other tenants, at least ten times the largest
  tenant, so the tenant is a small share of the table as it is in production.
  A table that holds only the tenant under test makes a sequential scan look
  cheap and correct.

For a table that is not in the size tiers, assume it is large: seed the
largest tenant at 100,000 rows or more and state the assumption. Bulk inserts
that trip foreign keys or triggers you are not testing can run under
`SET session_replication_role = replica` in the scratch database.

Say in the result how far the seed is below the production tier. A scan that
is acceptable on 500,000 rows is still a scan of a table with over 100 million.

## 4. Run it

Set the hosted planner values from
[Checking query plans](../../../docs/development/database.md#checking-query-plans)
and a timeout, then run the statement as the application does, as a prepared
statement with parameters:

```sql
SET random_page_cost = 1.1; SET work_mem = '16MB'; SET jit = off;
SET statement_timeout = '60s';

PREPARE q(uuid, timestamptz, int) AS
  SELECT ... WHERE link_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3;

SET plan_cache_mode = force_custom_plan;    -- planned for these parameter values
EXPLAIN (ANALYZE, BUFFERS) EXECUTE q('…', now(), 50);

SET plan_cache_mode = force_generic_plan;   -- planned without them, as a reused statement can be
EXPLAIN (ANALYZE, BUFFERS) EXECUTE q('…', now(), 50);
```

- Run each twice and keep both timings with their buffer `hit` and `read`
  counts. The first run is not a cold cache unless you controlled the cache;
  call the two first and repeated. Use the
  largest tenant's parameters, and for each optional filter the value that
  matches the most rows and a value that matches none: a filter that matches
  nothing makes a `LIMIT` scan read everything looking for a first row.
- The generic plan matters: SQLx prepares statements, and after five
  executions Postgres may switch a prepared statement to a plan built without
  the parameter values, when that plan looks no more expensive. Forcing it is
  the conservative check. An optional filter written `$2 IS NULL OR col < $2` is an index
  condition in the custom plan and a filter over every row in the generic one.
- `EXPLAIN ANALYZE` executes the statement. Measure an `INSERT`, `UPDATE`, or
  `DELETE` inside `BEGIN; … ROLLBACK;` each time, so the second run sees the
  same rows as the first.

## 5. Read the plan

Read actual rows, not estimates. Each of these fails the query unless the
table is known to be small:

- `Seq Scan` on a large table.
- An index scan whose `Rows Removed by Filter` dwarfs the rows it returns: the
  index narrows less than the predicate, and the rest is read and thrown away.
- A `Filter:` line that holds a function call or `SubPlan` on a node that
  processes many rows.
- `loops=` in the thousands on an inner node.
- A sort, hash, or `DISTINCT` fed by every row of the tenant when the query
  returns one page, or one that spills to disk.
- `Buffers:` in the hundreds of thousands for one page of results.

A `Filter` on a node that fetches one row by key is fine.

One more makes the plan untrustworthy rather than slow: estimated rows off
from actual by more than ten times on the node that reads a large table (a
`LIMIT` that stops a scan early does not count). It does not fail the query by
itself, but the plan was chosen for a query that does not exist and can flip
in production, which is what step 6 tests.

The rows a query touches should be explainable from its request: the page
size, the ids passed in, one parent's children. If the count grows with the
tenant or the table instead, the query is not bounded, whatever its `LIMIT`.

## 6. Run it again with wrong estimates

Production statistics lag behind imports and backfills, and a large tenant is
invisible in a sample of a table a thousand times its size, so the planner
often expects a handful of rows where there are tens of thousands.

Reproduce that in a second scratch database: load a small fixture (the crate's
test fixture, or a few rows per table), `ANALYZE`, turn autovacuum off on the
tables (`ALTER TABLE t SET (autovacuum_enabled = false)`), then run the seed
from step 3 without its `ANALYZE` and repeat step 4. Don't reuse the first
database: its statistics already describe the full seed. Create any index the
query needs before seeding, because `CREATE INDEX` refreshes the table's row
count.

## 7. Pass or fail

A query passes only if every run is acceptable: fresh and stale statistics,
custom and generic plan. When the runs differ in where a per-row function or
subquery sits, or in whether a predicate is an index condition, the good plan
is luck. Force the order (an `OFFSET 0` fence around the narrowed set, a
`MATERIALIZED` CTE, a rewritten join or predicate) and measure all runs again.

Some queries cannot pass by rewriting: the scope key and the sort column live
on different tables, or no index matches the filter. Then the fix is in the
schema (an index, or the scope key copied onto the table that is sorted). Say
so and take that to the user; don't commit the query as it is.

## 8. Record

Keep, for each query: the seed sizes and how they compare with the production
tier, the Postgres version, and from each run the execution time, the node
that reads each large table with its actual rows and `Rows Removed by Filter`,
and total buffers. That is the evidence the `## Database review` section of
the PR body asks for (see the [`git`](../git/SKILL.md) skill).
