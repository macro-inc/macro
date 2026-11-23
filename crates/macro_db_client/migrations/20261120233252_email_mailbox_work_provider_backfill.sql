-- Existing sync streams were Outlook-only; the constant default needs no DML.
-- Legacy reconciliation can contain Gmail draft-cleanup rows that the old
-- Outlook-only worker never claimed. Repair those asynchronously in bounded,
-- resumable maintenance batches.
SET LOCAL lock_timeout = '5s';

COMMENT ON COLUMN public.email_sync_streams.provider
    IS 'Authoritative link provider; legacy Outlook streams use the metadata-only default.';
COMMENT ON COLUMN public.email_message_reconciliation.provider
    IS 'Authoritative link provider; legacy cleanup rows are repaired by automatic resumable maintenance.';
