-- no-transaction
-- Per-inbox trigram index for the email Subject filter (`subject ILIKE
-- '%word%'`), so rare words read only matching messages instead of the whole
-- mailbox. Leads with link_id like email_contact_search_index; btree_gin is
-- created by 20260311180000 and pg_trgm by 20260106165331.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_link_subject_trgm
    ON email_messages USING gin (link_id, subject gin_trgm_ops);
