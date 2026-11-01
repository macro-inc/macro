-- no-transaction
-- The viewer's pending (unseen or seen) notifications for the work feed:
-- attention reads only these, so a long done history costs nothing. Covers
-- the read with notification_id, so it needs no user_notification heap pages.
-- Must stay a single statement: sqlx sends no-transaction migrations as
-- one batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_user_pending
  ON user_notification (user_id, created_at DESC) INCLUDE (notification_id)
  WHERE deleted_at IS NULL AND state <> 'done';
