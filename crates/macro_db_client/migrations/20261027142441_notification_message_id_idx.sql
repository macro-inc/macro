-- no-transaction
-- Channel-message notification lookups match this exact expression; without
-- an index on it, each requested message scans the whole notification table.
-- Must stay a single statement: sqlx sends no-transaction migrations as
-- one batch, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_message_id
  ON notification ((COALESCE(metadata->>'messageId', metadata->>'message_id', '')));
