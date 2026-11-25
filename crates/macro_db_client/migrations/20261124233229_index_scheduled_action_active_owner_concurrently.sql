-- no-transaction
-- An owner's active routines: enabled, and either watching events or holding
-- a future firing. Paused routines and finished one-time routines leave this
-- index, so active-routine cap checks stay bounded however many finished
-- one-time routines accumulate. Queries repeat the predicate verbatim.
-- Built CONCURRENTLY so routines keep saving and running. IF NOT EXISTS does
-- not repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_active_owner_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_active_owner_idx` before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_active_owner_idx
    ON scheduled_action (owner)
    WHERE enabled AND (event_filters IS NOT NULL OR next_run_at IS NOT NULL);
