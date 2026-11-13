-- no-transaction
-- idx_user_notification_user_pending with the lane included. The attention
-- feed reads one lane of the viewer's pending notifications; with the lane in
-- the index that read still needs no table pages. The key columns are
-- unchanged. The next migration drops the index this replaces.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_user_pending_lane
  ON user_notification (user_id, created_at DESC) INCLUDE (notification_id, lane)
  WHERE deleted_at IS NULL AND state <> 'done';
