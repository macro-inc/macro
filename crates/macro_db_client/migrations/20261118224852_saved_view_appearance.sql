-- Nullable metadata separate from consumer-owned configuration and its revision.
SET LOCAL lock_timeout = '2s';
ALTER TABLE saved_view ADD COLUMN appearance jsonb;
