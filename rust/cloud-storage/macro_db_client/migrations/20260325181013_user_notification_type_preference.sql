-- User notification type preferences
-- Allows users to opt out of specific notification types (e.g. channel_message_send)
-- Missing rows default to enabled; only rows with enabled = false suppress notifications.

CREATE TABLE user_notification_type_preference (
  user_id TEXT NOT NULL,
  notification_event_type VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, notification_event_type)
);

CREATE INDEX idx_user_notif_type_pref_user ON user_notification_type_preference (user_id);
