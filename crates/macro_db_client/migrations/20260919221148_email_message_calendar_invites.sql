-- Email display snapshots are not canonical calendar events or sync sources.
CREATE TABLE email_message_calendar_invites (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    component_id text NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY (message_id, component_id)
);
CREATE TABLE email_message_calendar_extraction (
    message_id uuid PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'ready', 'absent', 'unsupported')),
    parser_version smallint NOT NULL,
    -- Retain discovered parts so retries never re-fetch message MIME on opening.
    pending_parts jsonb NOT NULL DEFAULT '[]',
    attempts smallint NOT NULL DEFAULT 0,
    retry_after timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_message_calendar_extraction_pending
    ON email_message_calendar_extraction(retry_after) WHERE status = 'pending';
