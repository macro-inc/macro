-- Per-occurrence attendee state for recurrence exceptions.
--
-- Google never records an instance-scoped RSVP on the series master: an
-- attendee responding to one occurrence — or Google auto-declining it for an
-- out-of-office event — produces an exception instance carrying the full
-- attendee list with that one responseStatus changed. `calendar_event_attendees`
-- is keyed by event alone, so that state had nowhere to live and was dropped.
--
-- The marker distinguishes an exception that replaces the attendee list with
-- an empty one from an exception that inherits the series attendees: both
-- store zero attendee rows, and only the marker keeps reads from falling
-- back to the series list for an explicitly-empty override.
ALTER TABLE calendar_event_overrides
    ADD COLUMN IF NOT EXISTS attendees_overridden boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS calendar_event_override_attendees (
    event_id uuid NOT NULL,
    recurrence_id text NOT NULL,
    email text NOT NULL,
    display_name text,
    response_status text NOT NULL DEFAULT 'needs_action'
        CHECK (response_status IN ('needs_action', 'accepted', 'declined', 'tentative')),
    is_organizer boolean NOT NULL DEFAULT false,
    is_optional boolean NOT NULL DEFAULT false,
    is_self boolean NOT NULL DEFAULT false,
    comment text,
    PRIMARY KEY (event_id, recurrence_id, email),
    -- Overrides are replaced wholesale on every series refresh, so cascading
    -- keeps this table from outliving the exception it describes.
    FOREIGN KEY (event_id, recurrence_id)
        REFERENCES calendar_event_overrides (event_id, recurrence_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calendar_event_override_attendees_event_idx
    ON calendar_event_override_attendees (event_id);
