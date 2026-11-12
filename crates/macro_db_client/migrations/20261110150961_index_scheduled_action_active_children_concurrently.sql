-- no-transaction
-- A routine's active sub-routines: the ones counted against its cap, nested
-- under it in lists and paused with it. One-time sub-routines that have run
-- (a `once` trigger with no next run) leave this index, so those reads stay
-- bounded however many have finished. Queries repeat the predicate verbatim.
-- Built CONCURRENTLY so routines keep saving and running. IF NOT EXISTS does
-- not repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_active_children_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_active_children_idx` before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_active_children_idx
    ON scheduled_action (parent_id)
    WHERE parent_id IS NOT NULL AND NOT (trigger_type = 'once' AND next_run_at IS NULL);
