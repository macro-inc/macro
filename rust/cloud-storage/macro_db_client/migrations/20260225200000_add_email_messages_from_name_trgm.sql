-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_from_name_trgm
    ON email_messages USING gin (from_name gin_trgm_ops)
    WHERE from_name IS NOT NULL;
