-- Distinguish an exception that replaces the attendee list with an empty one
-- from an exception that inherits the series attendees. Attendee rows alone
-- cannot: both shapes store zero rows, so reads wrongly fell back to the
-- series list for an explicitly-empty override.
ALTER TABLE calendar_event_overrides
    ADD COLUMN IF NOT EXISTS attendees_overridden boolean NOT NULL DEFAULT false;

UPDATE calendar_event_overrides o
SET attendees_overridden = true
WHERE EXISTS (
    SELECT 1
    FROM calendar_event_override_attendees a
    WHERE a.event_id = o.event_id
      AND a.recurrence_id = o.recurrence_id
);
