-- Attempt tombstones outlive message deletion so delayed requests cannot send again.
-- Removing an inbox removes its delivery authority and all its attempts.
CREATE TABLE email_send_attempts (
    user_id TEXT NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL,
    request JSONB,
    message_id UUID,
    thread_id UUID,
    send_time TIMESTAMPTZ,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    restore_body_html TEXT,
    restore_body_text TEXT,
    restore_body_macro TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, link_id, attempt_id)
);
CREATE INDEX email_send_attempts_message_idx ON email_send_attempts(message_id)
    WHERE message_id IS NOT NULL;
