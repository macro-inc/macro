-- Add a done column to user_notification
ALTER TABLE user_notification ADD COLUMN done BOOLEAN NOT NULL DEFAULT FALSE;
