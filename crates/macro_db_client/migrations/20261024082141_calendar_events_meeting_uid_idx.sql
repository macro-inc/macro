-- no-transaction
-- Copies of one meeting are paired by `calendar_meeting_uid(ical_uid)`, which an
-- index on the raw UID cannot serve.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. No IF NOT EXISTS:
-- an interrupted concurrent build leaves an invalid index that a retry must
-- not accept (see docs/design/outlook-email-support.md).
CREATE INDEX CONCURRENTLY calendar_events_meeting_uid_idx
    ON calendar_events (calendar_meeting_uid(ical_uid));
