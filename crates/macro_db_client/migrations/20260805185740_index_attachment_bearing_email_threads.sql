-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_link_id_thread_id_has_atts
    ON email_messages (link_id, thread_id)
    WHERE has_attachments = true;
