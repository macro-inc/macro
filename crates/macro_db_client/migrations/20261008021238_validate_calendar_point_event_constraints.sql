-- Scan only after the replacement migration commits and releases its write locks.
ALTER TABLE calendar_events VALIDATE CONSTRAINT calendar_events_time_shape;
ALTER TABLE calendar_event_overrides VALIDATE CONSTRAINT calendar_event_overrides_time_shape;
ALTER TABLE calendar_event_occurrences VALIDATE CONSTRAINT calendar_event_occurrences_time_shape;
