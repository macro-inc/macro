-- no-transaction
-- Match the initial import candidate without traversing the other provider's
-- streams or the completed-folder polls. Retain the old index for old readers.
CREATE INDEX CONCURRENTLY email_sync_streams_provider_import_claim
    ON public.email_sync_streams (provider, next_run_at, id)
    WHERE kind = 'mail_folder' AND NOT initial_complete;
