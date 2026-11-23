-- Existing sync streams were Outlook-only; the constant default needs no DML.
-- Legacy reconciliation can contain Gmail draft-cleanup rows that the old
-- Outlook-only worker never claimed. Claims relabel them when due.
SET LOCAL lock_timeout = '5s';

COMMENT ON COLUMN public.email_sync_streams.provider
    IS 'Authoritative link provider; legacy Outlook streams use the metadata-only default.';
COMMENT ON COLUMN public.email_message_reconciliation.provider
    IS 'Authoritative link provider; legacy cleanup rows are relabelled by claims when due.';
