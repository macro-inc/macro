-- no-transaction
-- A person has at most one open pick of each catalog routine. Keeping one
-- checks for an existing pick under the person's suggestion lock first, so
-- this index only decides a race with the previous release, which takes no
-- lock, during the deploy. Dismissed, saved and retired picks stay out of it:
-- a retired pick may be suggested again, and the lock covers the rest.
-- Built CONCURRENTLY so suggestions keep being kept. IF NOT EXISTS does not
-- repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('routine_suggestion_open_catalog_key_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY routine_suggestion_open_catalog_key_idx` before
-- retrying.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS routine_suggestion_open_catalog_key_idx
    ON routine_suggestion (user_id, catalog_key)
    WHERE state = 'open' AND catalog_key IS NOT NULL;
