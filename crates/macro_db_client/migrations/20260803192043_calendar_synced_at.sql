-- Tracks when each provider calendar's sync state last committed, so the
-- backfill loop can hold Google's system calendars to a daily cadence.
-- Added separately because the calendar_entities migration had already been
-- applied to deployed databases when this column was introduced.
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS synced_at timestamptz;
