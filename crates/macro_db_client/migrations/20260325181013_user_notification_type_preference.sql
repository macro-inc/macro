-- User notification type preferences
-- A row means the user has disabled that notification type.
-- Absence of a row means the user receives that notification type (default).

CREATE TABLE user_notification_type_preference (
  user_id TEXT NOT NULL,
  notification_event_type VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, notification_event_type)
);

CREATE INDEX idx_user_notif_type_pref_user ON user_notification_type_preference (user_id);
