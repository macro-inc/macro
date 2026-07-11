-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_contacts_link_id_name
    ON email_contacts (link_id, name)
    WHERE name IS NOT NULL;
