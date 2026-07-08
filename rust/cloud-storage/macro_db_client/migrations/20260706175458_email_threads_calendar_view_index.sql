-- no-transaction
-- Matches the CalendarOnly candidate scan's ORDER BY
-- (COALESCE(latest_non_spam_message_ts, updated_at) DESC, id DESC) so
-- per-link ordered scans stop at the LIMIT instead of fetching and sorting
-- every flagged thread.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_calendar_view
    ON email_threads (link_id, (COALESCE(latest_non_spam_message_ts, updated_at)) DESC, id DESC)
    WHERE has_calendar_attachment;
