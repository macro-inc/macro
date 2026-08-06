-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_link_id_sent_covering
    ON email_messages (link_id) INCLUDE (id)
    WHERE is_sent = true;
