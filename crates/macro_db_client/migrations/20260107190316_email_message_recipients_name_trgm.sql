-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_message_recipients_name_trgm
    ON email_message_recipients USING gin (name gin_trgm_ops)
    WHERE name IS NOT NULL;
