-- no-transaction
-- The DM lookup (historical::find_dm, behind get-or-create and the read-only
-- direct message lookup) intersects the two people's participant rows,
-- including rows they left: an imported DM both people left is still the one
-- get-or-create reuses. Active rows are reached through
-- idx_comms_cp_active_by_user_channel; this index reaches the left ones, so
-- the lookup reads the two people's memberships instead of the whole primary
-- key. Left rows are a small part of the table.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_comms_cp_left_by_user_channel;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_cp_left_by_user_channel
    ON comms_channel_participants (user_id, channel_id)
    WHERE left_at IS NOT NULL;
