-- no-transaction
-- idx_user_notification_channel_threads with the lane included. The channel
-- thread feed now reads signal rows only; with the lane in the index it still
-- reads no table pages. The key columns and the predicate are unchanged, so
-- every query that seeks the old index seeks this one the same way. The next
-- migration drops the index this replaces.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. If an interrupted
-- deploy leaves an INVALID index behind, IF NOT EXISTS will not rebuild it;
-- drop it by hand and re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notification_channel_threads_lane
  ON user_notification (user_id, state, notification_id)
  INCLUDE (lane)
  WHERE deleted_at IS NULL
    AND event_item_type = 'channel'
    AND notification_event_type <> 'channel_message_send';
