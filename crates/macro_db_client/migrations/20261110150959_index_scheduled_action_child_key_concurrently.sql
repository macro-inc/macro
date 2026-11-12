-- no-transaction
-- One sub-routine per parent and key, so a keyed create that races another
-- updates the same row instead of adding a second. Partial: most routines
-- have no key. Built CONCURRENTLY so routines keep saving and running. IF NOT
-- EXISTS does not repair an INVALID index left by an interrupted build: check
-- `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_parent_child_key_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_parent_child_key_idx` before
-- retrying.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_parent_child_key_idx
    ON scheduled_action (parent_id, child_key)
    WHERE child_key IS NOT NULL;
