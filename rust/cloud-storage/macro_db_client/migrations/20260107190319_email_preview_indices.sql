-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_thread_date_not_draft
    ON public.email_messages (thread_id, internal_date_ts DESC)
    WHERE (is_draft = FALSE);