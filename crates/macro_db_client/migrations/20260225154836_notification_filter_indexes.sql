-- Composite index on notification for the EXISTS subqueries in soup/frecency/comms
-- dynamic filters that filter on both event_item_type and event_item_id.
CREATE INDEX IF NOT EXISTS  idx_notification_event_type_id
  ON notification (event_item_type, event_item_id);

-- Partial covering index for the EXISTS subquery used in soup/frecency/comms
-- dynamic filters. Covers done and seen_at so Postgres can evaluate the filter
-- predicate directly from the index without heap access.
CREATE INDEX IF NOT EXISTS idx_user_notification_active_filter
  ON user_notification (user_id, notification_id, done, seen_at)
  WHERE deleted_at IS NULL;
