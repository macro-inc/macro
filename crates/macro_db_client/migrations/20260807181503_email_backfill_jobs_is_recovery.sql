-- Marks backfill jobs created by the stale-cursor recovery path. Recovery
-- jobs skip the priority pass and refresh existing threads (fetching message
-- ids and backfilling any missing messages) so the sync-gap window's replies
-- in already-known threads are actually recovered.
ALTER TABLE email_backfill_jobs
    ADD COLUMN is_recovery boolean NOT NULL DEFAULT false;
