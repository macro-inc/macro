-- no-transaction

-- Supports one indexed latest-content probe per requested email thread.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_latest_content
    ON public.email_messages (
        thread_id,
        (COALESCE(internal_date_ts, sent_at, created_at)) DESC,
        id DESC
    )
    WHERE is_draft = FALSE;
