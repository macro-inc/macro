-- Table to store all email addresses that have unsubscribed from notifications
-- Eventually this may expand to support a more complex unsubscribe model
CREATE TABLE notification_email_unsubscribe (
  email TEXT PRIMARY KEY
);

CREATE TABLE user_notification_item_unsubscribe (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- Get by user_id
CREATE INDEX idx_user_notification_item_unsubscribe_user_id ON user_notification_item_unsubscribe (user_id);

-- Get by item_id
CREATE INDEX idx_user_notification_item_unsubscribe_item_id ON user_notification_item_unsubscribe (item_id);


CREATE TABLE user_notification_item_event_unsubscribe (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  notification_event_type TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id, notification_event_type)
);

-- Get by user_id
CREATE INDEX idx_user_notification_item_event_unsubscribe_user_id ON user_notification_item_event_unsubscribe (user_id);

-- Get by item_id
CREATE INDEX idx_user_notification_item_event_unsubscribe_item_id ON user_notification_item_event_unsubscribe (item_id);

CREATE INDEX idx_user_notification_item_event_unsubscribe_item_id_notification_event_type ON user_notification_item_event_unsubscribe (item_id, notification_event_type);
