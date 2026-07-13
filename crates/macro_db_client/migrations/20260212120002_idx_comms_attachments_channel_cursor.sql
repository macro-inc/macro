-- no-transaction

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_attachments_channel_cursor
    ON public.comms_attachments (channel_id, created_at DESC, id DESC);
