-- no-transaction
-- One viewer's notifications on one entity, by state and newest first. The
-- included columns let entity reads filter and order without the table.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_viewer_entity
  ON user_notification (user_id, event_item_type, event_item_id, state, created_at DESC, notification_id DESC)
  INCLUDE (notification_event_type, sent, seen_at)
  WHERE deleted_at IS NULL;
