-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS notification_channel_message_id_idx
    ON notification ((metadata->>'messageId'))
    WHERE event_item_type = 'channel';
