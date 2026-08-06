-- no-transaction
-- The replacement index was created before removing this COALESCE index.
DROP INDEX CONCURRENTLY IF EXISTS idx_email_threads_calendar_view;

-- To recreate the old index, run exactly:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_calendar_view
--     ON email_threads (link_id, (COALESCE(latest_non_spam_message_ts, updated_at)) DESC, id DESC)
--     WHERE has_calendar_attachment;
