CREATE TABLE notification (
  id UUID PRIMARY KEY NOT NULL, -- id of notification, self-generated UUIDv7
  notification_event_type VARCHAR(255) NOT NULL, -- the type of notification that this event generates
  event_item_id TEXT NOT NULL, -- id of the relevant item that is triggering the notification
  event_item_type TEXT NOT NULL, -- type of the relevant item that is triggering the notification
  service_sender TEXT NOT NULL, -- what service generated the notification
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time notification was created
  metadata JSONB -- any custom metadata that may be needed for the notification
);

CREATE TABLE user_notification (
  user_id TEXT NOT NULL, -- user id
  notification_id UUID NOT NULL REFERENCES notification (id) ON DELETE CASCADE, -- notification id
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time user notification was created
  sent BOOLEAN NOT NULL DEFAULT FALSE, -- whether the notification has been sent
  seen_at TIMESTAMP, -- time the notification was seen
  deleted_at TIMESTAMP, -- time the notification was deleted
  PRIMARY KEY (user_id, notification_id)
);

CREATE TYPE notification_preference_option as ENUM ('none', 'dot', 'ping');

CREATE TABLE notification_preference (
  item_id TEXT NOT NULL, -- id of item that the preference is for
  item_type TEXT NOT NULL, -- type of item (document | chat | etc...)
  user_id TEXT NOT NULL, -- user id
  notification_type notification_preference_option NOT NULL, -- type of preference
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time preference was created
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time preference was updated
  PRIMARY KEY (item_id, item_type, user_id)
);

-- Index on event_item_id and event_item_type to get notifications per event
CREATE INDEX idx_notification_event ON notification (event_item_id, event_item_type);

-- Index user id to get notifications per user
CREATE INDEX idx_user_notification_user ON user_notification (user_id);

-- Index user id to get user notifications per notification id
CREATE INDEX idx_user_notification_notification ON user_notification (notification_id);

CREATE INDEX idx_notification_preference_user ON notification_preference (user_id);

CREATE INDEX idx_notification_preference_item ON notification_preference (item_id, item_type);
