SET LOCAL lock_timeout = '5s';

-- Both work-table foreign keys validate automatically after the durable
-- reconciliation repair's scan-complete marker. Keep full child-table scans
-- outside the deploy transaction regardless of the legacy table size.
-- NOT VALID still enforces the constraints on every new or changed row.
COMMENT ON CONSTRAINT email_sync_streams_link_provider_fkey
    ON public.email_sync_streams
    IS 'Validated asynchronously by the leased mailbox provider repair';
COMMENT ON CONSTRAINT email_message_reconciliation_link_provider_fkey
    ON public.email_message_reconciliation
    IS 'Validated asynchronously after the leased provider repair completes';
