-- no-transaction
-- idx_user_notification_viewer_entity with the lane included. Entity reads
-- now filter on the lane; with it in the index they still read no table pages.
-- The key columns are unchanged, so every query that seeks the old index seeks
-- this one the same way. The next migration drops the index this replaces.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_viewer_entity_lane
  ON user_notification (user_id, event_item_type, event_item_id, state, created_at DESC, notification_id DESC)
  INCLUDE (notification_event_type, sent, seen_at, lane)
  WHERE deleted_at IS NULL;
