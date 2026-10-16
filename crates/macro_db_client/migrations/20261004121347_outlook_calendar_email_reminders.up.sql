SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE calendar_event_reminder_firings
    ADD COLUMN method TEXT NOT NULL DEFAULT 'popup',
    ADD CONSTRAINT calendar_event_reminder_firings_method_check
        CHECK(method IN ('popup','email')) NOT VALID;
ALTER TABLE calendar_event_reminder_deliveries
    ADD COLUMN method TEXT NOT NULL DEFAULT 'popup',
    ADD CONSTRAINT calendar_event_reminder_deliveries_method_check
        CHECK(method IN ('popup','email')) NOT VALID;
-- Build replacement keys concurrently before swapping the constraints.
