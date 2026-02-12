-- Top-level messages cursor query: covers (channel_id, created_at DESC, id DESC)
-- with partial predicate for thread_id IS NULL (only top-level messages).
-- Much smaller than a full index since replies are excluded.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_channel_toplevel_cursor
    ON public.comms_messages (channel_id, created_at DESC, id DESC)
    WHERE thread_id IS NULL;
