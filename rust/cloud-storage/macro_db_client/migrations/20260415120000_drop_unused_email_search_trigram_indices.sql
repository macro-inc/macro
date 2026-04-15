-- no-transaction

-- Email subject trigram index (was used by PG email subject name search)
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_subject_trgm;

-- Email contact search index trigram indices (was used by PG email contact search)
DROP INDEX CONCURRENTLY IF EXISTS idx_ecsi_link_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_ecsi_link_email_trgm;

-- Older per-table trigram indices superseded by email_contact_search_index, never dropped
DROP INDEX CONCURRENTLY IF EXISTS idx_email_contacts_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_from_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_email_message_recipients_name_trgm;
-- NOTE: idx_email_contacts_email_address_trgm is kept — still used by
-- email dynamic filters (Sender/Recipient/Cc/Bcc partial ILIKE matching).
