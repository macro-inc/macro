-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
CREATE INDEX CONCURRENTLY email_messages_provider_folder
    ON email_messages (link_id, provider_folder_id)
    WHERE provider_folder_id IS NOT NULL;
