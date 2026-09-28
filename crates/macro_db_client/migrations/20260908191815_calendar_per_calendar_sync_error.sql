-- Per-calendar sync failure isolation: a single unreadable calendar records
-- its own error and keeps retrying instead of wedging the whole account.
ALTER TABLE calendars
    ADD COLUMN IF NOT EXISTS last_sync_error text,
    ADD COLUMN IF NOT EXISTS last_sync_error_at timestamptz,
    ADD COLUMN IF NOT EXISTS consecutive_sync_failures integer NOT NULL DEFAULT 0;
