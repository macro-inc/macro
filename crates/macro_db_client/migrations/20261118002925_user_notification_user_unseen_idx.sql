-- no-transaction
-- The entities a viewer holds unseen notifications on, for the unread counts
-- beside the sidebar's sections. The count walks one entry per entity, so a
-- channel with thousands of unseen messages costs one probe, and a long seen
-- or done history costs nothing: those rows are not in the index.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_user_notification_user_unseen;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_user_unseen
  ON user_notification (user_id, event_item_type, event_item_id)
  WHERE deleted_at IS NULL AND state = 'unseen';
