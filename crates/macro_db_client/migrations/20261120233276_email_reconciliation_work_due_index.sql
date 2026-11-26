-- no-transaction
-- A held lease leaves the range without changing the real retry floor.
CREATE INDEX CONCURRENTLY email_message_reconciliation_unparked_due
    ON public.email_message_reconciliation (
        provider, is_import,
        (GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz))),
        link_id, generation, provider_id
    ) WHERE parked_at IS NULL;
