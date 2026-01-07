-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_contacts_name_trgm
    ON email_contacts USING gin (name gin_trgm_ops)
    WHERE name IS NOT NULL;
