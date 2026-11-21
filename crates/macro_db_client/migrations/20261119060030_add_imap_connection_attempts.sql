SET LOCAL lock_timeout = '5s';

-- Pending attempts own no mail content and hold no plaintext credentials.
-- An attempt remains replayable after engine promotion until its link and
-- initial stream are committed together. Completed receipts make retries safe.
CREATE TABLE email_imap_connection_attempts (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    credential_owner TEXT NOT NULL,
    email TEXT NOT NULL,
    link_id UUID NOT NULL,
    verification_id UUID NOT NULL,
    expected_generation BIGINT,
    sync_generation BIGINT NOT NULL CHECK (sync_generation > 0),
    grant_generation BIGINT NOT NULL CHECK (grant_generation > 0),
    completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_imap_connection_attempts_pending_link
    ON email_imap_connection_attempts(link_id) WHERE NOT completed;
CREATE INDEX email_imap_connection_attempts_pending
    ON email_imap_connection_attempts(created_at, id) WHERE NOT completed;
