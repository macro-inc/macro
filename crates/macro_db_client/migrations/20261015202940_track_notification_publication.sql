-- Existing notifications retain their already-published behavior during rolling deploys.
SET LOCAL lock_timeout = '5s';
ALTER TABLE notification ADD COLUMN publication_complete boolean NOT NULL DEFAULT true;
