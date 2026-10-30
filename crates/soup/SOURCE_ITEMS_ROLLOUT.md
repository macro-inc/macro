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
   in 500-item batches through `source_items_refresh`, the function the triggers
   use, so it is safe to run alongside writers and to interrupt and rerun. Each
   batch locks its items like a grant change and commits; contention retries
   after one second with a 200 ms lock timeout, and 30 failed attempts on one
   batch stop the run. The first run writes a row lock for every item as well
   as the new rows, so watch database load and replication lag.
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

Every trigger locks an item before rewriting its rows and rewrites them in a
later statement, so it reads whatever the previous lock holder committed. Saves
already hold the item's row lock; grant and subtype changes take it in the same
mode (`FOR NO KEY UPDATE`), in id order. An item insert in flight cannot be
locked by another transaction, so the insert holds advisory keys and locks the
grants it counted; a grant written for an item it cannot see waits on those keys
and looks again. No transaction holds more than about 5,000 advisory keys.

Rows are rebuilt from the inputs rather than adjusted by deltas, so a rewrite of
an item is always exact, whatever ran before it. The triggers refuse writes
under REPEATABLE READ or SERIALIZABLE with `25000`: an older snapshot could
miss a concurrent change.

A bulk grant change holds its items' row locks until it commits. Deleting a
team, for example, locks every document, chat and project shared with it while
it rewrites their rows, so saves to those items wait for it.

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

Soup's query tests run every case on both paths and require identical pages,
and assert the projection is exact after every fixture. `crates/source_items`
tests every kind of write, forced interleavings of each race, and concurrent
random writes with an audit of every committed snapshot.
