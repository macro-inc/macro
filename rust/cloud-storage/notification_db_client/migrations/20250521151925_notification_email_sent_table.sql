-- Create notification_email_sent table
CREATE TABLE notification_email_sent (
  user_id TEXT PRIMARY KEY NOT NULL, -- the id of the user
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
