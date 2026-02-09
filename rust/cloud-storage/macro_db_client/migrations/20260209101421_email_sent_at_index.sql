CREATE INDEX IF NOT EXISTS idx_email_messages_link_id_sent
    ON email_messages (link_id)
    WHERE is_sent = true;