# source_items

## What it is

Application maintenance for the `source_items` listing projection: one row per
(source, document/chat/project) that soup reads newest first. `entity_access`
and the item tables stay authoritative; this crate rebuilds affected rows inside
the writer's transaction. There are no maintenance triggers.

## Start here

- `src/lib.rs`: `sync_one`, `sync_many`, `sync_rows` — refresh items after
  their authoritative writes, in the same READ COMMITTED transaction.
- `src/lock.sql`, `src/sync.sql`: the item-row (and bounded advisory) locks,
  then the rebuild from current grants and item state.
- `src/project_deletion.rs`: capture the keys a project cascade will touch
  before deleting it.
- `src/backfill.rs`, `src/bin/backfill_source_items.rs`: resumable
  reconciliation for rollout and drift repair.

## Scope

- Owns: writes to the `source_items` table.
- Not here: reading the projection → `crates/soup` (`expanded/dynamic/feed.rs`);
  grant writes → `crates/entity_access_db_utils`, whose helpers already refresh.

## Recipes

- A new writer of `entity_access`, `"Document"`, `"Chat"`, `"Project"`, or
  `document_sub_type`: call a `sync_*` helper after its writes and before
  commit, or go through an `entity_access_db_utils` helper that does. A writer
  that skips it leaves drift only the backfill repairs.
- Bulk writes: collect every affected `(entity_type, entity_id)` and call
  `sync_rows` once, so one transaction locks its items in one order.

## Checks

- `cargo test -p source_items` (`SQLX_OFFLINE` unset; requires local MacroDB).
- Rollout, audit and recovery: `crates/soup/SOURCE_ITEMS_ROLLOUT.md`.

## Gotchas

- Refreshes reject autocommit connections and isolation levels other than
  READ COMMITTED: the refresh statement must see the previous lock holder's
  committed writes.
