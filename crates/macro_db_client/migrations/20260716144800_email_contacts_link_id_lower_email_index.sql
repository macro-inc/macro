-- no-transaction

-- Case-insensitive self-contact lookup for the inbox photo (links list).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_contacts_link_id_lower_email
    ON email_contacts (link_id, LOWER(email_address));
