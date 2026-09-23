-- Email display snapshots are not canonical calendar events or sync sources.
CREATE TABLE email_message_calendar_invites (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    component_id text NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY (message_id, component_id)
);
CREATE INDEX email_message_calendar_invites_uid
    ON email_message_calendar_invites ((snapshot->>'uid'));

-- Rows exist only for messages with calendar content, or history queued for reinspection.
CREATE TABLE email_message_calendar_extraction (
    message_id uuid PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('unprocessed', 'pending', 'ready', 'absent', 'unsupported')),
    parser_version smallint NOT NULL,
    -- Retain discovered parts so retries never re-fetch message MIME on opening.
    pending_parts jsonb NOT NULL DEFAULT '[]',
    attempts smallint NOT NULL DEFAULT 0,
    -- Fencing token; an expired worker cannot overwrite a newer claim.
    generation bigint NOT NULL DEFAULT 0,
    notification_pending boolean NOT NULL DEFAULT false,
    retry_after timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_message_calendar_extraction_pending
    ON email_message_calendar_extraction(retry_after)
    WHERE status IN ('unprocessed', 'pending') OR notification_pending;

-- A recurring exception advances independently of its master.
ALTER TABLE calendar_event_overrides ADD COLUMN sequence integer,
    ADD COLUMN source_updated_at timestamptz;
