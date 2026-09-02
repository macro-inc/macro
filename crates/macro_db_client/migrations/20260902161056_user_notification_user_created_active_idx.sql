-- no-transaction
-- Ordered scan for the soup notified-at candidate query: a user's live
-- notifications newest first, keyset-paginated on created_at.
-- Must stay a single statement: sqlx sends no-transaction migrations as
-- one batch, and CONCURRENTLY cannot run inside a transaction.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_user_notification_user_created_active;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_user_created_active
  ON user_notification (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
