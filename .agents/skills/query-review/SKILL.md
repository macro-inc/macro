---
name: query-review
description: Review new or changed SQL for what it costs on the production database, with evidence. Use when a diff adds or changes a sqlx query, assembled or QueryBuilder SQL, a Soup or GraphQL filter that becomes SQL, a SQL function, view, or trigger, or a caller that runs an existing query more often or over a wider scope.
---

# Query review

One request-path query that does work for every row of a large table can take
the primary database down: the page that fires it times out, the user retries,
the server keeps every copy running, and all of them fight over the same
pages. Such a query usually looks harmless in the diff: one extra predicate,
one helper function, a scope widened from a user to a team.

This review finds each changed query, works out how many rows it touches at
production size, and records the evidence. It reviews cost only. Macro usage,
the `.sqlx` cache, and injection are the
[`sqlx-query-validator`](../sqlx-query-validator/SKILL.md)'s job.

Never connect to a hosted dev or production database for this. Use a local one.

## 1. List every changed query

```sh
base=$(git merge-base HEAD origin/main)
git diff --name-status "$base" -- .sqlx                      # static queries added or removed; each file holds the SQL text
git diff "$base" -- '*.rs' | grep -nE '^[+-].*(QueryBuilder|push_bind|\.push\(|format!\(.*(SELECT|WHERE|JOIN))'
git diff --name-only "$base" -- '**/migrations/**' '*.sql'   # functions, views, triggers, indexes
```

A query is "changed" when any of these changed:

- its SQL text, including one fragment of assembled SQL. Assembled SQL has many
  shapes; review each shape the diff can produce, not only the default one.
- a SQL function, view, or trigger it uses. A changed function body changes
  every query that calls it: `git grep -n '<function_name>('` for the callers.
- its inputs: a scope widened from one user to a team, a list parameter that
  can now be long, a filter that became optional.
- how often it runs: a new loop around it, a new page, hook, or job that fires
  it, a refetch on every keystroke or cache wipe.

A diff that only adds a call to a function still changes a query. Open the
function's definition (often in a migration) and review its body as part of
the calling query.

## 2. Answer these for each query

1. **What fires it, and how often?** Name the user action or job. Can one page
   fire it more than once (retry, refetch, tab toggle, one call per row)? Does
   the client time out and retry while the server keeps running?
2. **How many rows does it start from?** Name the table it drives from and the
   predicate that narrows it first. Give the row count left after that
   predicate for the largest realistic tenant, not the average one, using
   [table sizes](table-sizes.md). Say what the count scales with: one user,
   one mailbox, team size, or the whole table.
3. **Which index serves it?** Name the index and the migration that creates
   it. Check that the filter uses its leading columns, that a partial index's
   predicate matches, and that nothing defeats it: a function or cast on the
   column, a leading-wildcard `LIKE`, an `OR` across columns, a type mismatch.
4. **What runs once per row?** Every function call, correlated subquery,
   `EXISTS`, and `LATERAL` in `WHERE`, `JOIN`, or the select list. Open each
   one, estimate one call's cost, and multiply by the rows it runs on. Unless
   Postgres inlines the function (a single plain `SELECT` expression with no
   subquery) the planner cannot see inside it: it uses the declared `COST`,
   small by default, and is free to evaluate it before a selective join has
   removed anything. A check that costs 10 ms is fine on 100 rows and an
   outage on 40,000.
5. **Where is the bound?** A `LIMIT` bounds the result, not the work, when a
   sort, `DISTINCT ON`, `GROUP BY`, or window function has to see every
   candidate first. Say which step bounds the rows processed. An unbounded
   result set needs a reason.
6. **What happens when it is slow?** Is there a `statement_timeout` or does it
   run until done? Does it hold row locks (`FOR UPDATE`, `FOR SHARE`) or sit in
   a transaction while it runs?
7. **Is it one query or N?** A query inside a loop, or one issued per item of a
   list response, is reviewed at N times its cost.

## 3. Get evidence

State the evidence level for each query:

- **`index`**: an equality lookup on a primary key or unique index, or on a
  named index whose leading columns match, returning a bounded number of rows.
  Naming the index is enough.
- **`measured`**: `EXPLAIN (ANALYZE, BUFFERS)` on a local database seeded to
  the size in question 2. Required when the query reads a
  [large table](table-sizes.md) and is not a plain `index` lookup, when the SQL
  is assembled at runtime, when a function or correlated subquery runs per
  row, or when it joins two large tables or pairs `ORDER BY`/`DISTINCT` with
  `LIMIT`.
- **`reasoned`**: no local database was available. Say exactly what has to be
  measured and report the finding as open. `reasoned` never closes a `block`.

To measure:

1. Create a scratch database on the local server, migrate it, and drop it when
   done. Don't seed the database the app or the tests use.

   ```sh
   createdb -h localhost query_review && sqlx migrate run --source crates/macro_db_client/migrations \
     --database-url postgres://<local-user>@localhost/query_review
   ```

2. Get the exact SQL. For a `query!`, it is in the `.sqlx` entry. For
   assembled SQL, run the test that executes the affected shape against a
   server started with `log_statement = all` and copy the statement from the
   log, or print `QueryBuilder::sql()` in the test. Don't retype it from the
   builder code.
3. Seed the tables the query reads with `INSERT ... SELECT FROM
   generate_series(...)` at the largest tenant's size, keeping the skew that
   matters: one mailbox with tens of thousands of threads, a domain that
   matches a few hundred of them. Then `ANALYZE`.
4. `SET` the hosted planner values from
   [Checking query plans](../../../docs/development/database.md#checking-query-plans),
   then run `EXPLAIN (ANALYZE, BUFFERS)` with a `statement_timeout`, cold and
   again warm.
5. Read actual rows, not estimates. Look for:
   - `Seq Scan` on a large table, or an index scan whose `Rows Removed by
     Filter` dwarfs the rows it returns;
   - a `Filter:` line that holds a function call or `SubPlan` on a node that
     processes many rows;
   - estimated rows off from actual by more than ten times: the plan was
     chosen for a query that does not exist, and can flip in production;
   - `loops=` in the thousands on an inner node;
   - sorts or hashes that spill to disk.
6. Measure again with wrong estimates. Production statistics lag behind
   imports and backfills, and a large tenant is invisible in a sample of a
   table a thousand times its size, so the planner often expects a handful of
   rows where there are tens of thousands. To reproduce that, load a small
   fixture, `ANALYZE`, turn autovacuum off on the tables
   (`ALTER TABLE t SET (autovacuum_enabled = false)`), then seed to size
   without analyzing, and run the same `EXPLAIN`.
7. A query passes only if both runs are acceptable. When the two plans differ
   in where a per-row function or subquery runs, the good plan is luck: force
   the order (an `OFFSET 0` fence around the narrowed set, a `MATERIALIZED`
   CTE, a rewritten join) and measure both again.

## 4. Report

One row per query, worst first:

| Severity | Query | Fired by | Rows touched at size | Index or bound | Evidence | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| block | `list_project_items`, team scope (`items_repo.rs:212`) | Project page, every open and refetch | every item of every team member (~40,000 each) × one `item_visible()` call (~10 ms) | none: the visibility check runs before the tag filter | measured: 4 s with fresh statistics, timed out at 120 s with stale ones (`Filter: item_visible(...)` on the item scan) | Apply the tag filter first, fence it, then check visibility; add a statement timeout |
| note | `get_project_settings` (`settings_repo.rs:41`) | settings page load | 1 | primary key `(team_id, user_id)` | index | Safe: single-row lookup |

Severity:

- **`block`**: on a request path or frequent job, work that grows with a large
  table, a whole tenant, or team size and has no bound; a per-row function or
  subquery over an unnarrowed set; a sequential scan of a large table; a slow
  query that clients can stack by retrying.
- **`fix`**: bounded, but wasteful or fragile: a missing index on a table that
  will grow, N+1 with small N, an unbounded result set on a small table, a
  plan that depends on an estimate, no timeout on a query that can be slow.
- **`note`**: safe; state the reason and the assumption it rests on.

Severity is for what the diff introduces or makes worse. A cost that was
already there and that the diff leaves alone is a `note`, marked pre-existing.

Every query gets a row, including the safe ones: the row says what was checked
and why it is safe. Don't report a query as safe without naming its index or
its bound.
