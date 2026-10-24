-- A Gmail label change Macro applied locally but Gmail has not confirmed yet.
-- Inbox sync keeps the local label state while a row exists, so a rate-limited
-- write waiting in the gmail_ops retry queue cannot be undone by sync.
-- The latest accepted change takes over the row for its message and label; an
-- operation clears only its own row (by write_id) when Gmail accepts or
-- rejects it. Rows of operations that never finish stop applying at
-- expires_at, and go with the message.
CREATE TABLE IF NOT EXISTS email_gmail_pending_label_writes (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    provider_label_id text NOT NULL,
    write_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (message_id, provider_label_id)
);
