-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_channel_toplevel_cursor
    ON public.comms_messages (channel_id, created_at DESC, id DESC)
    WHERE thread_id IS NULL;
