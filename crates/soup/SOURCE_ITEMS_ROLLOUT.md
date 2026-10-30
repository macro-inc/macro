# Source items rollout

`source_items` is a listing projection: one row per (source, document/chat/project)
that soup reads newest first. Database triggers keep it equal to what
`entity_access`, the item tables and `document_sub_type` say, for every writer:
application code, foreign-key cascades, scripts, and fixtures loaded in replica
mode. The migration's header comment describes the locking; `crates/source_items`
holds the backfill, the audit and the tests.

## Release order

1. **Deploy as usual.** The migration creates the table, its read index and the
   triggers in one transaction (5 s lock timeout; it needs a brief write lock on
   `entity_access`, `"Document"`, `"Chat"`, `"Project"` and `document_sub_type`).
   A second migration builds the `"Document"` owner index concurrently. From
   then on every write keeps the rows of the items it touches current, so no
   writer needs to deploy first. Projected reads stay off
   (`SOUP_SOURCE_ITEMS_ENABLED` defaults to false).
2. **Backfill against the primary.** Items untouched since the migration have no
   rows yet. With `DATABASE_URL` from the environment's normal secret handling:

   ```sh
   cargo run --release -p source_items --features cli --bin source_items -- backfill
   ```

   It rewrites every document, chat and project, and every id the table holds,
   in 500-item batches through `source_items_refresh`, which takes the items'
   buckets as a commit does, so it is safe to run alongside writers and to
   interrupt and rerun. Contention retries after one second with a 200 ms lock
   timeout, and 30 failed attempts on one batch stop the run. The first run also
   creates the mutex rows, so watch database load and replication lag. On a
   synthetic copy at production scale (11.8M documents, 13.9M grants) it wrote
   13.1M rows in 9 minutes and the audit took 69 seconds.
3. **Audit the primary and every replica soup reads:**

   ```sh
   cargo run --release -p source_items --features cli --bin source_items -- audit
   ```

   It compares the whole table with its inputs in one read-only snapshot and
   fails unless both mismatch counts are zero. It reads every grant and item, so
   allow for its load.
4. **Add the history index before enabling view-time sorts.** `ViewedAt` and
   `ViewedUpdated` read each user's `"UserHistory"` newest first. Without an
   index on `("userId", "itemType", "updatedAt", "itemId")` they sort the user's
   whole history of each type. Indexing `"updatedAt"` stops every view's history
   upsert from being a HOT update, so it is not in this release; add it in a
   separate concurrent migration when projected reads are ready.
5. **Enable projected reads gradually.** Set `SOUP_SOURCE_ITEMS_ENABLED=true` for
   a document storage canary and restart it. Watch soup latency and errors,
   write latency on the item and grant tables, lock waits and replication lag
   before expanding.

## Consistency and recovery

Statement triggers only record what changed, in a session temporary table; they
take no locks, so no writer waits on anything it did not wait on before. At
commit, a deferred trigger first re-queues itself behind the transaction's other
deferred constraint checks, then takes ACCESS SHARE on the five inputs, locks a
mutex row per touched item's bucket (`source_items_mutex`, created on first use)
in bucket order in one statement, and rewrites those items' rows in later
statements. Each rewrite therefore reads what the previous committer on that
item committed. A transaction holding buckets is past its statements and its
deferred checks and waits only for other such transactions, so the projection
cannot add a deadlock to any application lock order. Mutex rows are row locks,
so a transaction touching any number of items cannot fill PostgreSQL's shared
lock table.

Grant changes rewrite only the (item, source) rows they touched, saves only sort
keys, and inserts, deletes and subtype changes the item's rows; rows are rebuilt
from the inputs rather than adjusted by deltas. The triggers refuse writes under
REPEATABLE READ or SERIALIZABLE with `25000`: an older snapshot could miss a
concurrent change.

A bulk change rewrites its items' rows at commit while holding their buckets, so
another transaction's commit on one of those items waits for it. Deleting a
team that sees 200,000 items, for example, briefly delays commits that touch
those items; it does not block saves in the middle of a transaction.

`SET CONSTRAINTS ALL IMMEDIATE` makes the rewrite run at the end of each
statement instead; that stays exact, but the buckets are then held while the
transaction continues. The temporary tables rule out `PREPARE TRANSACTION`, and
`DISCARD TEMP` fails inside a transaction that wrote an input (between
transactions it is harmless).

For a read regression, set `SOUP_SOURCE_ITEMS_ENABLED=false` and restart.
Drift can only come from disabling the triggers or writing `source_items` by
hand; the backfill repairs it and the audit confirms it.

Verify `source_items_read` and `idx_document_owner_updated_live` (and the history
index from step 4) have `pg_index.indisready` and `pg_index.indisvalid` true
before enabling reads. An interrupted concurrent build can leave an invalid
index that `IF NOT EXISTS` skips: drop only that index with
`DROP INDEX CONCURRENTLY`, outside a transaction, then rerun the statement.

The migrations are forward-only and never move or delete authoritative rows.

## Query scope and validation

The projected path serves document/task, chat and project candidates for
`UpdatedAt`, `ViewedUpdated` and `ViewedAt`. `CreatedAt`, grouped listings and
other entity types keep their existing paths. Every filter and cursor predicate
runs before a per-source limit. Property rows keep their entity type across a
subtype change, so they cannot narrow document/task kinds.

An arm reads `source_items` only when a per-source scan can stop at the page:
every conjunct is served by the scan (kind, `"updatedAt"` bounds, the owner
driver for the viewer's own documents, id and project lookups, notifications)
or cannot be selective (a negated literal, or a disjunction with such a side).
Otherwise, for example a filter on another user's documents, a property value,
a creation date or a name, that arm reads its item table in the same query, as
it would with the projection disabled.

Soup's query tests run every case on both paths and require identical pages,
and assert the projection is exact after every fixture. `crates/source_items`
tests every kind of write, forced interleavings of each race, and concurrent
random writes with an audit of every committed snapshot.
