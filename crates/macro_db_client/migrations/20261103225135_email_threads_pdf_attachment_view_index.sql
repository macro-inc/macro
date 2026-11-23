-- no-transaction
-- Matches the candidate scan's ORDER BY
-- (COALESCE(latest_non_spam_message_ts, updated_at) DESC, id DESC) so per-link
-- ordered scans for Attachment(pdf) stop at the LIMIT, as
-- idx_email_threads_calendar_view does for CalendarOnly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_threads_pdf_attachment_view
    ON email_threads (link_id, (COALESCE(latest_non_spam_message_ts, updated_at)) DESC, id DESC)
    WHERE has_pdf_attachment;
