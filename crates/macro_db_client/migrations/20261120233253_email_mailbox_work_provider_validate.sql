SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.email_sync_streams
    VALIDATE CONSTRAINT email_sync_streams_link_provider_fkey;

ALTER TABLE public.email_message_reconciliation
    VALIDATE CONSTRAINT email_message_reconciliation_link_provider_fkey;
