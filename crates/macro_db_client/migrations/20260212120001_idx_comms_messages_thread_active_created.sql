-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_thread_active_created
    ON public.comms_messages (thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL AND deleted_at IS NULL;
