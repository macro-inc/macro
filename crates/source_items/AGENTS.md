# source_items

## What it is

Backfill, audit and tests for the `source_items` listing projection: one row per
(source, document/chat/project) that soup reads newest first. Triggers on
`entity_access`, `"Document"`, `"Chat"`, `"Project"` and `document_sub_type`
keep the table current for every writer, including foreign-key cascades and
replica-mode loads; `entity_access` and the item tables stay authoritative.

## Start here

- `crates/macro_db_client/migrations/*_source_items.sql`: the table, its read
  index and the triggers, which record changes per statement and rewrite rows
  at commit under per-bucket mutex rows (header comment).
- `src/backfill.rs`: fills rows for items that predate the triggers, through
  `source_items_refresh`, which locks buckets and rebuilds the way a commit does.
- `src/audit.rs`, `src/audit.sql`: counts rows that differ from the inputs, in
  one read-only snapshot.
- `src/bin/source_items.rs`: `backfill` and `audit` subcommands for rollout.
- `src/test/concurrency.rs`: each race in every commit order, and lock orders
  from real writers that must not wait on the projection.
- `src/test/fuzz.rs`: concurrent random writes with audits of every snapshot.

## Scope

- Owns: the tests and tooling for the projection's maintenance.
- Not here: reading the projection → `crates/soup` (`expanded/dynamic/feed.rs`);
  rollout and recovery → `crates/soup/SOURCE_ITEMS_ROLLOUT.md`.

## Recipes

- Change what a row holds or which inputs it reads: change the migration's
  functions in a new migration, then `src/audit.sql` to match, then extend
  `src/test.rs` and the fuzz's write mix.

## Checks

- `cargo test -p source_items` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Gotchas

- Writes to the inputs must run under READ COMMITTED; the triggers raise
  `25000` otherwise, because an older snapshot could miss a concurrent change.
- Never write `source_items` outside the triggers and the backfill: a hand
  edit is drift that only the backfill repairs.
- Name every permanent object with its schema in the migration's functions; they
  run at COMMIT under whatever search_path the writer set.
- The rewrite functions take id arrays as parameters, whose size their plans
  cannot see. Reach grants and items only through index probes (one-id lateral
  calls, `source_items_wanted`, grants matched on the uuid column), never by
  joining against an unindexed set, or a bulk change goes quadratic.
  `bulk_grant_changes_commit_in_linear_time` forces nested loops to catch it.
- Writers of the inputs cannot use `PREPARE TRANSACTION` (the change record is a
  temporary table), and `SET CONSTRAINTS ALL IMMEDIATE` rewrites rows per
  statement, holding buckets for the rest of the transaction.
