-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_user_history_thread_link
    ON public.email_user_history USING btree (thread_id, link_id);