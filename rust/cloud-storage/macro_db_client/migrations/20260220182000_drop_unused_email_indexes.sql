-- no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_email_attachments_provider_attachment_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_email_threads_non_spam_ts;
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_starred_view;
DROP INDEX CONCURRENTLY IF EXISTS idx_email_messages_from_name_trgm;
