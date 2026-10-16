-- Set when a link's teardown starts. A marked link never resumes syncing, and its
-- data is purged in bounded batches before the row itself is deleted.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_links ADD COLUMN deleting_at TIMESTAMPTZ;
