SET LOCAL lock_timeout = '1s';

-- A first import lists this month and next before the whole window. The scan
-- that lists the whole window afterwards carries its id here; any other scan
-- of a calendar never synced lists the near window first.
ALTER TABLE calendar_outlook_work ADD COLUMN whole_window_scan_id uuid;
