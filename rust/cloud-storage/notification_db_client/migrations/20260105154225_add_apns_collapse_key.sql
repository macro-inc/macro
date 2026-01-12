-- Add apns_collapse_key column to notification table for iOS push notification management.
-- This allows each notification to have a unique collapse key, enabling notifications
-- to stack in the notification center while still being individually clearable.
ALTER TABLE notification ADD COLUMN apns_collapse_key TEXT;
