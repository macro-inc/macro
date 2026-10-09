DELETE FROM calendar_event_reminder_firings WHERE method='email';
DELETE FROM calendar_event_reminder_deliveries WHERE method='email';
ALTER TABLE calendar_event_reminder_firings DROP CONSTRAINT calendar_event_reminder_firings_pkey;
ALTER TABLE calendar_event_reminder_firings ADD PRIMARY KEY(event_id,occurrence_key,minutes_before);
ALTER TABLE calendar_event_reminder_deliveries DROP CONSTRAINT calendar_reminder_delivery_identity;
ALTER TABLE calendar_event_reminder_deliveries ADD UNIQUE(event_id,occurrence_key,minutes_before,fire_at);
ALTER TABLE calendar_event_reminder_firings DROP COLUMN method;
ALTER TABLE calendar_event_reminder_deliveries DROP COLUMN method;
