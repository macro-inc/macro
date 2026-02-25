-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_non_spam_ts_id
ON email_threads (link_id, latest_non_spam_message_ts DESC, id DESC)
WHERE latest_non_spam_message_ts IS NOT NULL;
