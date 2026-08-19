ALTER TABLE in_progress_user_link
    ADD COLUMN provider email_user_provider_enum NOT NULL DEFAULT 'GMAIL',
    ADD COLUMN granted_microsoft_scopes text[] NOT NULL DEFAULT '{}';

CREATE TABLE email_outlook_sync_state (
    link_id uuid PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    subscription_id text UNIQUE,
    subscription_expires_at timestamptz,
    delta_cursor text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_outlook_sync_state_subscription_expires_at
    ON email_outlook_sync_state (subscription_expires_at);

ALTER TABLE email_sync_tokens
    ALTER COLUMN contacts_sync_token TYPE text,
    ALTER COLUMN other_contacts_sync_token TYPE text;
