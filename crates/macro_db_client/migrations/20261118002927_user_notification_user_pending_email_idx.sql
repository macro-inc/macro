-- no-transaction
-- A viewer's pending (unseen or seen) mail notifications, newest first, with
-- the thread each is about. Mail stays unread in the notifications inbox
-- while its thread is unread, whatever its notifications' state, so the
-- unread counts look for unread threads among the newest of these rows.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_user_notification_user_pending_email;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_user_pending_email
  ON user_notification (user_id, created_at DESC) INCLUDE (event_item_id)
  WHERE deleted_at IS NULL AND state <> 'done' AND event_item_type = 'email_thread';
