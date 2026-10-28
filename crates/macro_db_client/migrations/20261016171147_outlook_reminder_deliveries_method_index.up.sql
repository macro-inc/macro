-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY calendar_event_reminder_deliveries_method_key
    ON calendar_event_reminder_deliveries (event_id, occurrence_key, minutes_before, fire_at, method);
