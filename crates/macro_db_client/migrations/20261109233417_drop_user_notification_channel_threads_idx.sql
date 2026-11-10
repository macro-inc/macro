-- no-transaction
-- Replaced by idx_user_notification_channel_threads_lane, which has the same
-- columns and predicate plus the lane.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction.
DROP INDEX CONCURRENTLY IF EXISTS idx_user_notification_channel_threads;
