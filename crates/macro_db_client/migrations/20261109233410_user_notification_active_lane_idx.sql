-- no-transaction
-- idx_user_notification_active_filter with the lane added. Filters that ask
-- whether the viewer has a notification in some state probe one notification
-- at a time; with the lane in the index they still read no table pages. The
-- next migration drops the index this replaces.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_active_lane
  ON user_notification (user_id, notification_id, state, lane)
  WHERE deleted_at IS NULL;
