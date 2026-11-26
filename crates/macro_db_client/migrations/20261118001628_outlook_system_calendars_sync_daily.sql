-- Outlook discovery marks a mailbox's own read-only system calendars
-- (holidays, birthdays), which sync once a day as Google's do. Google's are
-- recognized by their calendar id instead. A constant default makes this a
-- catalog-only change, with no table rewrite.
SET LOCAL lock_timeout = '1s';
ALTER TABLE calendars ADD COLUMN system_calendar boolean NOT NULL DEFAULT false;
