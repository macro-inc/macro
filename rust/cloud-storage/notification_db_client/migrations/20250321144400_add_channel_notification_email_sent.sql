-- Creates channel_notification_email_sent table
CREATE TABLE channel_notification_email_sent (
  channel_id UUID NOT NULL, -- the id of the channel
  user_id TEXT NOT NULL, -- the id of the user
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id) -- composite primary key
);

CREATE INDEX idx_channel_notification_email_sent_channel ON channel_notification_email_sent (channel_id);
CREATE INDEX idx_channel_notification_email_sent_user ON channel_notification_email_sent (user_id);
