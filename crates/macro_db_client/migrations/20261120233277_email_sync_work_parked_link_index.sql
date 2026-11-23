-- no-transaction
-- One prefix probe skips a parked mailbox regardless of its folder count.
CREATE INDEX CONCURRENTLY email_sync_streams_parked_link
    ON public.email_sync_streams (link_id, generation, kind, id) WHERE parked_at IS NOT NULL;
