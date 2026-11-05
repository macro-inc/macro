-- The Outlook reader revision that last read each listed event, or found its
-- stored copy. A delta calendar reads an event again when it has no stored
-- copy and was last read by an older revision, so events an older build
-- skipped as unreadable come back once a build can read them. Rows written
-- before this column, and by builds that do not set it, stay NULL, which
-- counts as older than any revision.
SET LOCAL lock_timeout = '5s';

ALTER TABLE calendar_outlook_members ADD COLUMN reader_revision smallint;
