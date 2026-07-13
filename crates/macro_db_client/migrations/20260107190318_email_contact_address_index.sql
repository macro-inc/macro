-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_contacts_email_address_trgm
    ON email_contacts USING gin (email_address gin_trgm_ops);
