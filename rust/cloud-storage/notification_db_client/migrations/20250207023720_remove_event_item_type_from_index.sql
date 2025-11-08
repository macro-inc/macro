-- Remove event_item_type from index on notification
DROP INDEX IF EXISTS idx_notification_event;

CREATE INDEX idx_notification_event ON notification (event_item_id);
