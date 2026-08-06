-- no-transaction
-- Matches CalendarOnly's per-link ordering while keeping updated_at out of the
-- index so unrelated thread updates remain eligible for HOT updates.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_calendar_view_link_ts_id
    ON email_threads (link_id, latest_non_spam_message_ts DESC NULLS LAST, id DESC)
    WHERE has_calendar_attachment;
