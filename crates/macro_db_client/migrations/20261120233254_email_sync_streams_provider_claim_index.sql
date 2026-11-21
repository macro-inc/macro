-- no-transaction
-- Old binaries still need the unprefixed due-order index during rollout.
CREATE INDEX CONCURRENTLY email_sync_streams_provider_claim
    ON public.email_sync_streams (provider, kind, next_run_at, id);
