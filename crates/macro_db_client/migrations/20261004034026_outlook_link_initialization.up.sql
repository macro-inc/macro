SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE email_links
    ADD COLUMN provider_tenant_id text,
    ADD COLUMN provider_mailbox_id text;
-- Build email_links_outlook_identity concurrently after committing these columns.

-- Retain a non-secret receipt after consuming an OAuth attempt. An HTTP retry
-- returns the same mailbox; it cannot start another import or grant access twice.
CREATE TABLE email_link_initializations (
    attempt_id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
