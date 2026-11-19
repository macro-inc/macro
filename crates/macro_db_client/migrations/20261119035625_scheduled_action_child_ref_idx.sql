-- no-transaction
-- A sub-routine by its parent and key as one value, so the lookup can only
-- use this index: with stale statistics, (parent_id, child_key) loses to the
-- (parent_id, created_by_run_id) index and reads the parent's whole family.
-- Unique, as the pair is: a parent id's text is fixed-length. Partial: most
-- routines have no key. Built CONCURRENTLY so routines keep saving and
-- running. IF NOT EXISTS does not repair an INVALID index left by an
-- interrupted build: check `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_child_ref_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_child_ref_idx` before retrying.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_child_ref_idx
    ON scheduled_action ((parent_id::text || '/' || child_key))
    WHERE child_key IS NOT NULL;
