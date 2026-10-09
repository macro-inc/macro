ALTER TABLE email_links
    ADD COLUMN provider_tenant_id text,
    ADD COLUMN provider_mailbox_id text;
CREATE UNIQUE INDEX email_links_outlook_identity
    ON email_links (provider_tenant_id,provider_mailbox_id)
    WHERE provider = 'OUTLOOK' AND provider_tenant_id IS NOT NULL AND provider_mailbox_id IS NOT NULL;

-- Retain a non-secret receipt after consuming an OAuth attempt. An HTTP retry
-- returns the same mailbox; it cannot start another import or grant access twice.
CREATE TABLE email_link_initializations (
    attempt_id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
