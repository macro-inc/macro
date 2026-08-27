-- Google Calendar reports a creator separately from the organizer. When
-- someone writes onto a calendar they do not own, the calendar owner is the
-- organizer and the writer is the creator. Persist both so the product can
-- label the calendar and "Created by" without conflating them.
ALTER TABLE calendar_events
    ADD COLUMN creator_email text,
    ADD COLUMN creator_name text;
