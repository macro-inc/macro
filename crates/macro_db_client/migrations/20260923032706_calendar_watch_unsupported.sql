-- When Google last refused a push channel for this calendar
-- (pushNotSupportedForRequestedResource). Watch renewal skips the calendar
-- until the refusal ages out; the poller keeps it in sync meanwhile.
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS watch_unsupported_at timestamptz;
