-- no-transaction
-- An owner's top-level routines, oldest first, for the agent dashboard's
-- routines list. Finished one-time sub-routines share their parent's owner
-- and accumulate without bound, so the owner index would read every one of
-- them; this index holds only top-level rows and serves the list's order.
-- Its key is `owner COLLATE "C"` (byte equality, the same matches as the
-- default collation) and the list compares that way, so the planner can't
-- pick `scheduled_action_owner_idx` for it when statistics lag behind a
-- burst of sub-routines.
-- Built CONCURRENTLY so routines keep saving and running. IF NOT EXISTS does
-- not repair an INVALID index left by an interrupted build: check `SELECT
-- indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_top_level_owner_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_top_level_owner_idx` before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_top_level_owner_idx
    ON scheduled_action ((owner COLLATE "C"), created_at, id)
    WHERE parent_id IS NULL;
