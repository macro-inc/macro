-- no-transaction
-- The exact expression serves both the due range and its deterministic order.
-- Existing due indexes remain available to rolling old binaries.
CREATE INDEX CONCURRENTLY email_sync_streams_unparked_due
    ON public.email_sync_streams (
        provider, kind,
        (GREATEST(next_run_at,
            COALESCE(provider_retry_at, '-infinity'::timestamptz),
            COALESCE(lease_until, '-infinity'::timestamptz))),
        id
    ) WHERE parked_at IS NULL;
