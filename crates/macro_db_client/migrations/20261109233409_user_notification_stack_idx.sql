-- no-transaction
-- One stack's active notifications for its owner: a stack's lane change
-- updates these rows, and a stack row reads them. Almost no row has a stack,
-- so the index stays small.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_stack
  ON user_notification (user_id, stack_id)
  WHERE deleted_at IS NULL AND stack_id IS NOT NULL;
