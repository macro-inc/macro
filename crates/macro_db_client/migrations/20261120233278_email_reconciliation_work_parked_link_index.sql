-- no-transaction
-- Both next-link discovery and bounded unpark use this same partial index.
CREATE INDEX CONCURRENTLY email_message_reconciliation_parked_link
    ON public.email_message_reconciliation (link_id, generation, provider_id)
    WHERE parked_at IS NOT NULL;
