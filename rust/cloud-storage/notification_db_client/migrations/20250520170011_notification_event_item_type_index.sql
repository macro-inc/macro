-- Add migration script here
CREATE INDEX idx_notification_event_item_type ON notification (event_item_type);
