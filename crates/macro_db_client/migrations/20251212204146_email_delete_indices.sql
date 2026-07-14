-- Indices to speed up email link deletion
CREATE INDEX IF NOT EXISTS idx_email_messages_replying_to_id
    ON public.email_messages (replying_to_id)
    WHERE replying_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_user_history_thread_id
    ON public.email_user_history (thread_id);

CREATE INDEX IF NOT EXISTS idx_email_threads_link_id
    ON public.email_threads (link_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_link_id
    ON public.email_messages (link_id);