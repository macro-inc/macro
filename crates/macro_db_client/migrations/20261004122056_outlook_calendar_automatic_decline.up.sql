ALTER TABLE calendar_event_sources ADD COLUMN automatic_decline JSONB;
CREATE TABLE calendar_outlook_declines (
    id UUID PRIMARY KEY,
    work_id UUID NOT NULL REFERENCES calendar_outlook_work(id) ON DELETE CASCADE,
    invitation_id TEXT NOT NULL,
    recurrence_id TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX calendar_outlook_declines_pending ON calendar_outlook_declines(work_id) WHERE confirmed_at IS NULL;
