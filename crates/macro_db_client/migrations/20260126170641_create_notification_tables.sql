-- Consolidated notification schema for macrodb
-- This is a single migration combining all notification tables

-- ============================================================================
-- TYPES
-- ============================================================================

CREATE TYPE notification_device_type_option AS ENUM ('ios', 'android');

-- ============================================================================
-- TABLES
-- ============================================================================

-- Main notification table
CREATE TABLE notification (
  id UUID PRIMARY KEY NOT NULL, -- id of notification, self-generated UUIDv7
  notification_event_type VARCHAR(255) NOT NULL, -- the type of notification that this event generates
  event_item_id TEXT NOT NULL, -- id of the relevant item that is triggering the notification
  event_item_type TEXT NOT NULL, -- type of the relevant item that is triggering the notification
  service_sender TEXT NOT NULL, -- what service generated the notification
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time notification was created
  metadata JSONB, -- any custom metadata that may be needed for the notification
  sender_id TEXT, -- id of the sender
  apns_collapse_key TEXT -- iOS push notification collapse key
);

-- User notification junction table
CREATE TABLE user_notification (
  user_id TEXT NOT NULL, -- user id
  notification_id UUID NOT NULL REFERENCES notification (id) ON DELETE CASCADE, -- notification id
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time user notification was created
  sent BOOLEAN NOT NULL DEFAULT FALSE, -- whether the notification has been sent
  seen_at TIMESTAMP, -- time the notification was seen
  deleted_at TIMESTAMP, -- time the notification was deleted
  done BOOLEAN NOT NULL DEFAULT FALSE, -- whether user marked it done
  is_important_v0 BOOLEAN NOT NULL DEFAULT FALSE, -- importance flag
  PRIMARY KEY (user_id, notification_id)
);

-- Table to store all email addresses that have unsubscribed from notifications
CREATE TABLE notification_email_unsubscribe (
  email TEXT PRIMARY KEY
);

-- User unsubscribe from specific items
CREATE TABLE user_notification_item_unsubscribe (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- Email unsubscribe code for email links (renamed with notification_ prefix)
CREATE TABLE notification_email_unsubscribe_code (
  email TEXT PRIMARY KEY, -- The email address should be lowercased before insertion
  code UUID UNIQUE NOT NULL -- UUID used in the email unsubscribe link
);

-- User device registration for push notifications (renamed with notification_ prefix)
CREATE TABLE notification_user_device_registration (
  id UUID PRIMARY KEY NOT NULL, -- registration id, self-generated UUIDv7
  user_id TEXT NOT NULL, -- user associated with the device
  device_token TEXT NOT NULL, -- device-app combo from registering with a Push Notification Service
  device_endpoint TEXT UNIQUE NOT NULL, -- push notification endpoint, must be unique; index is auto-created
  device_type notification_device_type_option NOT NULL, -- type of device (ios | android)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time registration was created
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time endpoint was updated
  last_used_at TIMESTAMP -- time endpoint was last used to send a notification
);

-- Channel notification email sent tracking
CREATE TABLE channel_notification_email_sent (
  channel_id UUID NOT NULL, -- the id of the channel
  user_id TEXT NOT NULL, -- the id of the user
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id) -- composite primary key
);

-- User mute notification setting
CREATE TABLE user_mute_notification (
  user_id TEXT PRIMARY KEY -- the user who has muted notifications
);

-- Notification email sent tracking
CREATE TABLE notification_email_sent (
  user_id TEXT PRIMARY KEY NOT NULL, -- the id of the user
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- notification indexes
CREATE INDEX idx_notification_event ON notification (event_item_id);
CREATE INDEX idx_notification_event_item_type ON notification (event_item_type);

-- user_notification indexes
CREATE INDEX idx_user_notification_user ON user_notification (user_id);
CREATE INDEX idx_user_notification_notification ON user_notification (notification_id);

-- user_notification_item_unsubscribe indexes
CREATE INDEX idx_user_notification_item_unsubscribe_user_id ON user_notification_item_unsubscribe (user_id);
CREATE INDEX idx_user_notification_item_unsubscribe_item_id ON user_notification_item_unsubscribe (item_id);

-- notification_email_unsubscribe_code indexes
CREATE UNIQUE INDEX notification_email_unsubscribe_code_code_idx ON notification_email_unsubscribe_code (code);

-- notification_user_device_registration indexes
CREATE INDEX idx_notification_user_device_registration_user ON notification_user_device_registration (user_id);
CREATE INDEX idx_notification_user_device_registration_device_token ON notification_user_device_registration (device_token);

-- channel_notification_email_sent indexes
CREATE INDEX idx_channel_notification_email_sent_channel ON channel_notification_email_sent (channel_id);
CREATE INDEX idx_channel_notification_email_sent_user ON channel_notification_email_sent (user_id);
