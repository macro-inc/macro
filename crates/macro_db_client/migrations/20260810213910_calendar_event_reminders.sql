-- Google Calendar-style event reminders (alarms).
--
-- Reminder configuration is per-user state on the user's copy of an event,
-- mirroring Google's model: an event either follows its calendar's default
-- reminders or carries explicit overrides. Overrides are stored as a jsonb
-- array of { "method": text, "minutes": int } objects in Google's shape so
-- unknown methods survive a round trip; only "popup" reminders ever fire
-- Macro notifications ("email" reminders are sent by Google itself).

ALTER TABLE calendars
    ADD COLUMN default_reminders jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE calendar_events
    ADD COLUMN reminders_use_default boolean NOT NULL DEFAULT true,
    ADD COLUMN reminder_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The firing schedule: one row per (occurrence, popup reminder offset),
-- materialized inside the same transaction that replaces an event's
-- occurrences and rebuilt whenever the event's reminders or its calendar's
-- defaults change. Pure schedule — delivery state lives in the deliveries
-- table so wholesale occurrence rebuilds cannot resurrect a sent alarm.
CREATE TABLE calendar_event_reminder_firings (
    event_id uuid NOT NULL,
    occurrence_key text NOT NULL,
    minutes_before integer NOT NULL CHECK (minutes_before >= 0),
    fire_at timestamptz NOT NULL,
    PRIMARY KEY (event_id, occurrence_key, minutes_before),
    FOREIGN KEY (event_id, occurrence_key)
        REFERENCES calendar_event_occurrences (event_id, occurrence_key)
        ON DELETE CASCADE
);

-- Drives the minutely sweep's due scan.
CREATE INDEX calendar_event_reminder_firings_due_idx
    ON calendar_event_reminder_firings (fire_at);

-- Exactly-once delivery claims, keyed on the firing identity including its
-- resolved instant: the insert is the claim, and a moved event fires again at
-- its new time because the old claim no longer matches. Deliberately not
-- foreign-keyed to occurrences — claims must survive the delete-then-insert
-- occurrence replacement that syncs perform.
CREATE TABLE calendar_event_reminder_deliveries (
    id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    occurrence_key text NOT NULL,
    minutes_before integer NOT NULL,
    fire_at timestamptz NOT NULL,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, occurrence_key, minutes_before, fire_at)
);
