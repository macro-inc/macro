-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY calendar_event_reminder_firings_method_key
    ON calendar_event_reminder_firings (event_id, occurrence_key, minutes_before, method);
