-- Retain the operation across old-event retirement. Disconnecting its calendar
-- or deleting the actor removes snapshots and recovery records.
CREATE TABLE calendar_event_replacements (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    master_id TEXT NOT NULL,
    recurrence_id TEXT,
    snapshot JSONB NOT NULL,
    next_step INTEGER NOT NULL DEFAULT 0 CHECK (next_step >= 0),
    command JSONB,
    replacement_provider_id TEXT,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX calendar_event_replacements_active
    ON calendar_event_replacements (calendar_id, master_id) WHERE result IS NULL;
CREATE INDEX calendar_event_replacements_actor ON calendar_event_replacements (user_id);
