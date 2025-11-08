CREATE TYPE device_type_option as ENUM ('ios', 'android');

CREATE TABLE user_device_registration (
  id UUID PRIMARY KEY NOT NULL, -- registration id, self-generated UUIDv7
  user_id TEXT NOT NULL, -- user associated with the device
  device_token TEXT NOT NULL, -- device-app combo from registering with a Push Notification Service
  device_endpoint TEXT UNIQUE NOT NULL, -- push notification endpoint, must be unique; index is auto-created
  device_type device_type_option NOT NULL, -- type of device (ios | android)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time registration was created
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- time endpoint was updated
  last_used_at TIMESTAMP -- time endpoint was last used to send a notification
);

CREATE INDEX idx_user_device_registration_user ON user_device_registration (user_id);

CREATE INDEX idx_user_device_registration_device_token ON user_device_registration (device_token);
