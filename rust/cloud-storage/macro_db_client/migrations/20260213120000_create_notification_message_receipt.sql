-- Table for tracking message receipts and their delivery status
-- Associates message_ids (from push notification services) with user_notification records

CREATE TABLE notification_message_receipt (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_id UUID NOT NULL,
  failed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_at TIMESTAMP,
  CONSTRAINT fk_user_notification
    FOREIGN KEY (user_id, notification_id)
    REFERENCES user_notification (user_id, notification_id)
    ON DELETE CASCADE
);

-- Index for checking all messages for a given user_notification
CREATE INDEX idx_notification_message_receipt_user_notification
  ON notification_message_receipt (user_id, notification_id);
