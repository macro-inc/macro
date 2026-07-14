-- no-transaction
-- Serves the team-scoped dedupe_key lookup: the first non-draft message with
-- a global_id per thread, ORDER BY internal_date_ts ASC NULLS LAST, id ASC
-- LIMIT 1. Default btree ordering (ASC NULLS LAST) matches exactly, so the
-- subquery becomes a single forward index probe instead of a backward scan
-- over idx_email_messages_thread_date_not_draft plus an incremental sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_thread_root_global
    ON email_messages (thread_id, internal_date_ts, id)
    WHERE is_draft = FALSE AND global_id IS NOT NULL;
