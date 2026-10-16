DROP TRIGGER calendar_outlook_projection_changed ON calendar_events;
DROP FUNCTION calendar_outlook_projection_changed();
DROP TABLE calendar_projection_outbox;
DROP TABLE calendar_outlook_work;
ALTER TABLE calendars DROP COLUMN online_meeting_providers;
ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_conference_provider_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_conference_provider_check CHECK(conference_provider IN ('google_meet','other'));
