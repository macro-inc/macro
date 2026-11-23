-- no-transaction
-- One viewer's channel notifications that can name a thread, by state. The
-- channel thread feed collects its notified roots from these rows; message
-- sends, the bulk of channel notifications, never carry a thread.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_channel_threads
  ON user_notification (user_id, state, notification_id)
  WHERE deleted_at IS NULL
    AND event_item_type = 'channel'
    AND notification_event_type <> 'channel_message_send';
