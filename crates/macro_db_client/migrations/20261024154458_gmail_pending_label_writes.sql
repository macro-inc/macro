SET LOCAL lock_timeout = '1s';

-- Gmail label changes Macro applied locally but Gmail has not confirmed yet,
-- one row per write on a message's label, newest by seq. Inbox sync keeps the
-- local label state while an unexpired row exists, so a rate-limited write
-- waiting in the gmail_ops retry queue cannot be undone by sync.
-- Only the newest row's write sends that label to Gmail; an older write waits
-- until the newer one is confirmed (its rows go) or abandoned (its row goes,
-- and the label returns to the state the next older row or the first write
-- left it in). A confirmed write removes its row and every older one. Rows of
-- operations that never finish stop applying at expires_at, and go with the
-- message.
CREATE TABLE IF NOT EXISTS email_gmail_pending_label_writes (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    provider_label_id text NOT NULL,
    write_id uuid NOT NULL,
    -- Whether the write leaves the label on the message.
    label_present boolean NOT NULL,
    -- The label's state before the write, as Gmail will have it if this write
    -- and every newer one are abandoned.
    label_present_before boolean NOT NULL,
    expires_at timestamptz NOT NULL,
    UNIQUE (message_id, provider_label_id, write_id)
);
