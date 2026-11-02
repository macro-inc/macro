-- Open tracking is opt-in per inbox.
ALTER TABLE email_settings
    ADD COLUMN read_receipts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- One pixel per delivered message. The token is kept so delivery retries and
-- Outlook draft revisions rebuild the same pixel URL; it only lets its holder
-- count an open of that one message.
CREATE TABLE email_message_read_receipts (
    message_id uuid PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    open_count integer NOT NULL DEFAULT 0 CHECK (open_count >= 0),
    first_opened_at timestamptz,
    last_opened_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
