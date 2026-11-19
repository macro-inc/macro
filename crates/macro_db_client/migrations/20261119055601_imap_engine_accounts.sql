SET LOCAL lock_timeout = '5s';

-- Engine state belongs to one email link; disconnect cascades all retained mail and secrets.
CREATE TABLE imap_accounts (
    link_id UUID PRIMARY KEY REFERENCES email_links(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    sync_generation BIGINT NOT NULL,
    grant_generation BIGINT NOT NULL,
    credential_ciphertext BYTEA NOT NULL,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision BIGINT NOT NULL DEFAULT 0,
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX imap_accounts_scheduler ON imap_accounts(updated_at,link_id);
CREATE TABLE imap_verifications (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    credential_ciphertext BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_by UUID REFERENCES email_links(id) ON DELETE CASCADE
);
CREATE INDEX imap_verifications_expiry ON imap_verifications(expires_at);
