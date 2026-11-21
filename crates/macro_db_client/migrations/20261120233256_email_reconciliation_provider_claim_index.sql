-- no-transaction
-- Keep is_import before available_at and name both values in the claim; PG14
-- otherwise reads backed-off rows between its import/live groups. Retain the
-- existing unprefixed index for rolling binaries.
CREATE INDEX CONCURRENTLY email_message_reconciliation_provider_claim
    ON public.email_message_reconciliation (
        provider, is_import, available_at, link_id, provider_id
    );
