-- no-transaction
-- Optimize indexes for paginated channel messages queries

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_channel_toplevel_cursor
    ON public.comms_messages (channel_id, created_at DESC, id DESC)
    WHERE thread_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_thread_active_created
    ON public.comms_messages (thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_attachments_channel_cursor
    ON public.comms_attachments (channel_id, created_at DESC, id DESC);
