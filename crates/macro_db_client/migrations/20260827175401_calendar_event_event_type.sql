-- Google's eventType distinguishes status-style entries (working location,
-- out of office, focus time, birthdays) from ordinary meetings. It gates
-- which events resolve the calendar's default reminders: Google never
-- notifies for status events, so Macro must not either.

ALTER TABLE calendar_events
    ADD COLUMN event_type text NOT NULL DEFAULT 'default'
        CHECK (event_type IN (
            'default', 'out_of_office', 'focus_time', 'working_location',
            'birthday', 'from_gmail'
        ));

-- Already-synced events were ingested before eventType was parsed, so their
-- stored projections all read 'default'. Dropping every continuation token
-- forces each calendar's next scheduled poll into a full snapshot, which
-- re-fetches events with the field populated; unchanged projections are
-- skipped by the identical-payload check, so the sweep costs reads only.
UPDATE calendars SET sync_token = NULL;
