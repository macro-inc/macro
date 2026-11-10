---
name: query-writing
description: Use when you are about to write or change SQL, before the first line and again before you commit it. Applies to any new or changed sqlx `query!`, `query_as!`, or `query_scalar!`, QueryBuilder or other assembled SQL, a Soup or GraphQL filter that becomes SQL, a SQL function, view, or trigger, and code that calls an existing query in a loop, from a new page or job, or with a wider scope (a team instead of a user, a list instead of one id). Covers how to write the query so it stays bounded and index-backed, and the required EXPLAIN (ANALYZE, BUFFERS) on a production-size local database before the commit. Reviewing a finished diff is query-review; macro and cache checks are sqlx-query-validator.
---

# Query writing

A request-path query that does work for every row of a large table can take
the primary database down, and it looks harmless when written: one extra
predicate, one helper function, a scope widened from a user to a team. The
time to find that out is while the query is being written, with a plan in
hand, not in review.

## The rule

Every query you write or change is run through `EXPLAIN (ANALYZE, BUFFERS)` on
a local database seeded to production size before it is committed. There is
no exemption for queries that look simple. Follow
[Measuring a query plan](../query-review/measuring-plans.md); it covers the
scratch database, the seed, the runs, and how to read the plan.

"Changed" includes a query you did not edit: one whose SQL function, view, or
trigger you changed, one you now call in a loop or from a new page or job, and
one you now pass a wider scope (a team instead of a user, a list instead of
one id).

The plan must show all four, judged against [table sizes](../query-review/table-sizes.md):

1. **No full scan of a large table.** No `Seq Scan` on a table in the size
   tiers or on one that grows per message, event, or log line, and no index
   scan that reads a whole tenant and filters most of it away.
2. **Every predicate that narrows is index-backed.** It appears under
   `Index Cond`, not `Filter`, on the node that reads the large table.
3. **Rows touched are bounded by the request.** The actual rows read follow
   from the page size, the ids passed in, or one parent's children. They do
   not grow with the tenant, the team, or the table.
4. **A statement timeout covers it.** Any query whose cost depends on a
   tenant's data runs under `statement_timeout`: `SET LOCAL` in its
   transaction (`crates/notification/src/outbound/retention.rs`,
   `dynamic_email_thread_cursor` in `crates/email`) or a pool created with the
   option (`crates/github/src/outbound/pg_github_repo.rs`). Most pools set no
   default, so a slow query otherwise runs until it finishes, long after the
   client gave up and retried. A repository that is handed its pool does not
   know that pool's settings: find where the service builds it, and if it sets
   no timeout, set one in the query's transaction. A lookup of one row by
   primary key needs none.

If a local database is not available, say so and stop before committing the
query; don't substitute reasoning for the plan.

## Before writing

Answer these first; they decide the query's shape.

- **What fires it, and how often?** A page load, a keystroke, a job per
  message. A page that can refetch or retry fires it many times.
- **Which table drives it, and how big is it** for the largest tenant
  ([table sizes](../query-review/table-sizes.md))? Read the table's indexes in
  its migrations or with the `dump-schema` skill. Don't guess them.
- **What is the narrowest key the request already has?** A thread id, a
  mailbox, a channel. Start from it.

## Writing it

### Start from the narrowest set

Drive the query from the predicate that leaves the fewest rows, and apply
everything expensive after it.

- Scope first: `WHERE t.link_id = ANY($1)`, `WHERE m.thread_id = $1`. A query
  on a large table with no tenant or parent key in its `WHERE` is a table scan.
- A function, `EXISTS`, or correlated subquery in `WHERE` runs once for every
  row that reaches it. The planner does not know what a SQL function costs and
  may run it before the selective filter. Apply cheap, selective filters in a
  subquery, fence it with `OFFSET 0`, and run the expensive check on what is
  left, as `dynamic_email_thread_cursor` does for its team privacy check.
- A scope that widens (one user to a team) multiplies the rows. Measure it at
  the widest scope, for the largest team.

### Page by key, not by offset

`OFFSET n` reads and discards `n` rows on every page. Use a keyset: order by
an indexed column plus a unique tiebreaker, and continue from the last row.

```sql
WHERE e.subject_id = $1
  AND (e.occurred_at, e.id) < (COALESCE($2::timestamptz, 'infinity'),
                               COALESCE($3::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
ORDER BY e.occurred_at DESC, e.id DESC
LIMIT $4
```

That is `crates/activity/src/outbound/pg_activity_repo/team_feed.sql`. Two
details in it matter:

- The `ORDER BY` matches an index, column for column and direction for
  direction, so Postgres walks the index and stops at the `LIMIT` instead of
  sorting the tenant.
- The first page uses `COALESCE`, not `$2 IS NULL OR (…) < (…)`. The `OR` form
  stops being an index condition once the prepared statement gets a generic
  plan. Separate first-page and next-page queries
  (`crates/activity/src/outbound/pg_activity_repo/timeline.rs`) work too.

The scope key, the sort columns, and the tiebreaker must sit in one index on
one table. When the scope is on a parent (a channel's messages) and the sort
is on a child (their attachments), no index can serve the page and Postgres
reads the whole parent. Sort by the parent's column instead, or put the scope
key on the child with an index; the second is a schema change to raise with
the user.

`OFFSET` is acceptable only on a set that is small by construction, such as
one entity's pending requests.

### Write predicates the index can use

- Compare the bare column. `lower(col) = $1`, `col::text = $1`, and
  `date(col) = $1` cannot use an index on `col`. Cast the parameter instead:
  `col = $1::uuid`.
- An expression index is used only when the query repeats its expression
  exactly: `idx_email_contacts_email_domain` is on
  `lower(split_part(email_address, '@', 2))`, and the domain filter in
  `crates/email` writes that same expression.
- A partial index is used only when the query repeats its `WHERE` predicate in
  a form the planner can prove.
- A composite index is used from its leading columns: `(link_id, created_at)`
  serves `link_id = $1 AND created_at < $2`, not `created_at < $2` alone.
- `LIKE '%x'`, `ILIKE`, `OR` across different columns, and `<>` do not narrow
  through a b-tree. Use the trigram index where one exists, or restructure.

### Bound every list

- Every query that returns a list has a `LIMIT`, or a parent key that bounds
  it and a reason it cannot grow.
- `LIMIT` bounds the result, not the work, when a sort, `DISTINCT ON`,
  `GROUP BY`, or window function must see every candidate first. Narrow before
  those steps, or order by an index so the limit can stop the scan.
- Select the columns you need. `SELECT *` on a wide table reads the row and
  its TOAST data for every candidate.

### One query for many rows

A query inside a loop costs its plan times the loop. Pass the ids as an array
and join once:

```sql
FROM unnest($1::uuid[]) AS ids(thread_id)
CROSS JOIN LATERAL (
    SELECT m.id, m.thread_id FROM email_messages m WHERE m.thread_id = ids.thread_id
) m
```

(`crates/email/src/outbound/email_pg_repo/preview/attachments_by_thread_ids.sql`),
or `WHERE id = ANY($1)` for a plain lookup. Cap the array's length at the
caller. For writes, insert from `unnest` in one statement and keep it
idempotent with `ON CONFLICT` (CS-02).

### When it needs an index

Add an index when the narrowing predicate or the `ORDER BY` has none, and only
after checking that no existing index already leads with those columns
(CS-06). Every index is paid for on each write to the table.

- Create it in its own migration, generated with the
  [`sqlx-migration`](../sqlx-migration/SKILL.md) skill: a single
  `CREATE INDEX CONCURRENTLY` in a `-- no-transaction` file, like
  `crates/macro_db_client/migrations/20261006151520_email_threads_non_spam_link_sort.sql`.
- Match the query: equality columns first, then the sort columns in the
  query's direction; make it partial when the query always filters on a
  constant.
- Run the [`migration-review`](../migration-review/SKILL.md) skill on the
  file.
- Measure the query again with the index in the scratch database, and confirm
  the plan uses it.

## Before committing

1. Measure, as above, and fix until the plan passes all four checks in every
   run. If no rewrite can pass without a schema change, stop and report that
   with the plans instead of committing.
2. Run the [`sqlx-query-validator`](../sqlx-query-validator/SKILL.md) skill
   for macro use and the `.sqlx` cache.
3. Record the evidence listed in
   [Measuring a query plan](../query-review/measuring-plans.md#8-record). It
   goes in the PR body's `## Database review` section, where the
   [`query-review`](../query-review/SKILL.md) checks it before the push.
