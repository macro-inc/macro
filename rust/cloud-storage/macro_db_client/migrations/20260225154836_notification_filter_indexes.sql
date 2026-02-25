-- Replace two single-column indexes on notification with one composite index.
-- Every query that filters on event_item_id also filters on event_item_type,
-- so the composite index serves both patterns with a single index seek.
DROP INDEX idx_notification_event;
DROP INDEX idx_notification_event_item_type;

CREATE INDEX idx_notification_event_type_id
  ON notification (event_item_type, event_item_id);

-- Drop redundant single-column index on user_notification.
-- (user_id) is fully covered by the PK (user_id, notification_id).
DROP INDEX idx_user_notification_user;

-- Partial covering index for the EXISTS subquery used in soup/frecency/comms
-- dynamic filters. Covers done and seen_at so Postgres can evaluate the filter
-- predicate directly from the index without heap access.
CREATE INDEX idx_user_notification_active_filter
  ON user_notification (user_id, notification_id, done, seen_at)
  WHERE deleted_at IS NULL;
