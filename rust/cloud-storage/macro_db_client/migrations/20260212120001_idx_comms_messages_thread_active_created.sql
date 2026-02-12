-- Thread stats + preview queries: covers (thread_id, created_at DESC)
-- with partial predicate filtering deleted replies.
-- Supports both COUNT/MAX aggregation and ROW_NUMBER window function.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_thread_active_created
    ON public.comms_messages (thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL AND deleted_at IS NULL;
