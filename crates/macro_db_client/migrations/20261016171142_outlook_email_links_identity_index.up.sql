-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY email_links_outlook_identity
    ON email_links (provider_tenant_id, provider_mailbox_id)
    WHERE provider = 'OUTLOOK' AND provider_tenant_id IS NOT NULL AND provider_mailbox_id IS NOT NULL;
