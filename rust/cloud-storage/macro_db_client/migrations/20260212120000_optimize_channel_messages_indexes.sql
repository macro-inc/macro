-- Optimize indexes for paginated channel messages queries

-- Top-level messages cursor query: covers (channel_id, created_at DESC, id DESC)
-- with partial predicate for thread_id IS NULL (only top-level messages).
-- Much smaller than a full index since replies are excluded.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_channel_toplevel_cursor
    ON public.comms_messages (channel_id, created_at DESC, id DESC)
    WHERE thread_id IS NULL;

-- Thread stats + preview queries: covers (thread_id, created_at DESC)
-- with partial predicate filtering deleted replies.
-- Supports both COUNT/MAX aggregation and ROW_NUMBER window function.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_messages_thread_active_created
    ON public.comms_messages (thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL AND deleted_at IS NULL;

-- Channel attachments cursor query: covers (channel_id, created_at DESC, id DESC)
-- for cursor-based pagination. Existing idx_comms_attachments_channel_created
-- uses ASC which requires a backward scan and can't seek on the (created_at, id) cursor.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_attachments_channel_cursor
    ON public.comms_attachments (channel_id, created_at DESC, id DESC);
