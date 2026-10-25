-- What a planning run has found in the source so far, shown while it is
-- `running`. Nullable, so code deployed before this change keeps working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN scanned_pages INTEGER,
    ADD COLUMN scanned_data_sources INTEGER;
