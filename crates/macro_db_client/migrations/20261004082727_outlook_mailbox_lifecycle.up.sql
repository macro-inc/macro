ALTER TABLE email_links ADD COLUMN disconnect_requested_at timestamptz;

-- Non-secret email-owned capability projection. Authentication retains sole
-- ownership of refresh tokens and validates the binding on every acquisition.
CREATE TABLE email_link_microsoft_scopes (
    link_id uuid PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    grant_generation bigint NOT NULL,
    granted_scopes text[] NOT NULL,
    calendar_disabled_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each consenting Macro participant retains their own grant. Leaving an inbox
-- can transfer custody to another participant without moving encrypted tokens.
CREATE TABLE email_mailbox_custodians (
    link_id uuid NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    fusionauth_user_id text NOT NULL,
    grant_id uuid NOT NULL,
    grant_generation bigint NOT NULL,
    granted_scopes text[] NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(link_id,actor_id)
);
CREATE INDEX email_mailbox_custodians_owner ON email_mailbox_custodians(fusionauth_user_id);

-- Intentionally no link FK: deleting mailbox content must not discard pending
-- credential revocation or disconnect notifications.
CREATE TABLE email_mailbox_lifecycle_outbox (
    id uuid PRIMARY KEY,
    link_id uuid NOT NULL,
    payload jsonb NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_mailbox_lifecycle_outbox_due ON email_mailbox_lifecycle_outbox(available_at);
