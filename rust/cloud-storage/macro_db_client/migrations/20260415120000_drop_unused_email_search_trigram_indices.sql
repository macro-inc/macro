-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_subject_trgm;
-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_ecsi_link_name_trgm;
-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_ecsi_link_email_trgm;
-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_email_contacts_name_trgm;
-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_from_name_trgm;
-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_email_message_recipients_name_trgm;
