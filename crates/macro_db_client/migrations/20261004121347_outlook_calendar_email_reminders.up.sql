ALTER TABLE calendar_event_reminder_firings ADD COLUMN method TEXT NOT NULL DEFAULT 'popup' CHECK(method IN ('popup','email'));
ALTER TABLE calendar_event_reminder_deliveries ADD COLUMN method TEXT NOT NULL DEFAULT 'popup' CHECK(method IN ('popup','email'));
ALTER TABLE calendar_event_reminder_firings DROP CONSTRAINT calendar_event_reminder_firings_pkey;
ALTER TABLE calendar_event_reminder_firings ADD PRIMARY KEY (event_id,occurrence_key,minutes_before,method);
ALTER TABLE calendar_event_reminder_deliveries DROP CONSTRAINT calendar_event_reminder_deliv_event_id_occurrence_key_minut_key;
ALTER TABLE calendar_event_reminder_deliveries ADD CONSTRAINT calendar_reminder_delivery_identity UNIQUE(event_id,occurrence_key,minutes_before,fire_at,method);
