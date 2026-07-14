-- Add a general index for notification-type lookups/deletes. This keeps the
-- cleanup below from scanning the entire notification table and is useful for
-- future notification-type maintenance.
--
-- Note: macro_db_client migrations run inside a transaction, so this cannot use
-- CREATE INDEX CONCURRENTLY.
CREATE INDEX IF NOT EXISTS idx_notification_event_type
  ON notification (notification_event_type);

-- All existing document_mention notifications predate the required flattened
-- ChannelMentionMetadata fields and will fail deserialization.
DELETE FROM notification
WHERE notification_event_type = 'document_mention';
