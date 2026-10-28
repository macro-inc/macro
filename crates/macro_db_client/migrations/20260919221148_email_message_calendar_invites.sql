-- Email display snapshots are not canonical calendar events or sync sources.
CREATE TABLE email_message_calendar_invites (
    message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    component_id text NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY (message_id, component_id)
);

-- A recurring exception advances independently of its master.
ALTER TABLE calendar_event_overrides ADD COLUMN sequence integer,
    ADD COLUMN source_updated_at timestamptz;
