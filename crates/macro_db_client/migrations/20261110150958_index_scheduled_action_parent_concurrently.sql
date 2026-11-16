-- no-transaction
-- Finds a routine's sub-routines, and among them the ones one run created.
-- Partial: top-level routines have no parent. Built CONCURRENTLY so routines
-- keep saving and running. IF NOT EXISTS does not repair an INVALID index
-- left by an interrupted build: check `SELECT indisvalid FROM pg_index WHERE
-- indexrelid = to_regclass('scheduled_action_parent_run_idx')`, and if false
-- run `DROP INDEX CONCURRENTLY scheduled_action_parent_run_idx` before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_parent_run_idx
    ON scheduled_action (parent_id, created_by_run_id)
    WHERE parent_id IS NOT NULL;
