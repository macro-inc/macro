SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- All key columns are already NOT NULL. Attaching the concurrent indexes only
-- changes metadata; keep both replacements atomic and preserve constraint names.
ALTER TABLE calendar_event_reminder_firings
    DROP CONSTRAINT calendar_event_reminder_firings_pkey,
    ADD CONSTRAINT calendar_event_reminder_firings_pkey
        PRIMARY KEY USING INDEX calendar_event_reminder_firings_method_key;
ALTER TABLE calendar_event_reminder_deliveries
    DROP CONSTRAINT calendar_event_reminder_deliv_event_id_occurrence_key_minut_key,
    ADD CONSTRAINT calendar_reminder_delivery_identity
        UNIQUE USING INDEX calendar_event_reminder_deliveries_method_key;
