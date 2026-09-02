-- Ordered scan for the soup notified-at candidate query: a user's live
-- notifications newest first, keyset-paginated on created_at.
CREATE INDEX IF NOT EXISTS idx_user_notification_user_created_active
  ON user_notification (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
