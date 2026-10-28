-- no-transaction
-- Deleting an email_messages row cascades here by message_id, which the
-- (link_id, message_id) primary key cannot serve.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_scheduled_messages_message_id
    ON email_scheduled_messages (message_id);
