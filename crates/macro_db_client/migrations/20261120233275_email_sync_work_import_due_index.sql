-- no-transaction
-- A separate ordered import window preserves its bounded five-minute head start.
CREATE INDEX CONCURRENTLY email_sync_streams_unparked_import_due
    ON public.email_sync_streams (
        provider,
        (GREATEST(next_run_at,
            COALESCE(provider_retry_at, '-infinity'::timestamptz),
            COALESCE(lease_until, '-infinity'::timestamptz))),
        id
    ) WHERE parked_at IS NULL AND kind = 'mail_folder' AND NOT initial_complete;
