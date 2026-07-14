-- no-transaction
-- Matches the latest-message lateral's ORDER BY COALESCE(internal_date_ts,
-- created_at) DESC so the per-thread LIMIT 1 walks newest-first and stops at
-- the first match instead of reading every message in the thread.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_thread_id_effective_date_desc
    ON email_messages (thread_id, COALESCE(internal_date_ts, created_at) DESC);
