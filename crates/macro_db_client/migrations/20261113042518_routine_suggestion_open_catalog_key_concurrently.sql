-- no-transaction
-- A person has at most one open pick of each catalog routine. Keeping one
-- checks for an existing pick under the person's suggestion lock first, so
-- this index only decides a race with the previous release, which takes no
-- lock, during the deploy. Dismissed, saved and retired picks stay out of it:
-- a retired pick may be suggested again, and the lock covers the rest.
-- Built CONCURRENTLY so suggestions keep being kept.
--
-- If the build fails, it leaves an INVALID index, which IF NOT EXISTS would
-- then skip. The likely cause is the previous release keeping a second open
-- pick of a key after the backfill retired the duplicates. Before retrying:
-- 1. Check `SELECT indisvalid FROM pg_index WHERE indexrelid =
--    to_regclass('routine_suggestion_open_catalog_key_idx')`; if false, run
--    `DROP INDEX CONCURRENTLY routine_suggestion_open_catalog_key_idx`.
-- 2. Run the backfill's dedupe again (in
--    20261113042517_backfill_routine_suggestion_state.sql: retire all but the
--    best open pick of each user and catalog key).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS routine_suggestion_open_catalog_key_idx
    ON routine_suggestion (user_id, catalog_key)
    WHERE state = 'open' AND catalog_key IS NOT NULL;
