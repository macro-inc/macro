-- Existing event_item_id/event_item_type remain the primary non-null entity
-- for a notification. Add an optional secondary entity reference.
ALTER TABLE notification
  ADD COLUMN secondary_event_item_id TEXT,
  ADD COLUMN secondary_event_item_type TEXT,
  ADD CONSTRAINT notification_secondary_event_item_pair_check
    CHECK ((secondary_event_item_id IS NULL) = (secondary_event_item_type IS NULL));

COMMENT ON COLUMN notification.secondary_event_item_id IS 'id of an optional secondary entity related to the notification';
COMMENT ON COLUMN notification.secondary_event_item_type IS 'type of an optional secondary entity related to the notification';

CREATE INDEX idx_notification_secondary_event_type_id
  ON notification (secondary_event_item_type, secondary_event_item_id)
  WHERE secondary_event_item_id IS NOT NULL;
