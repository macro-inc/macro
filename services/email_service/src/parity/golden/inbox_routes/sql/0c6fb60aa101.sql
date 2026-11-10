DELETE FROM calendar_event_reminder_deliveries d WHERE d.event_id = ANY($1) AND NOT EXISTS ( SELECT 1 FROM calendar_events e WHERE e.id = d.event_id )
