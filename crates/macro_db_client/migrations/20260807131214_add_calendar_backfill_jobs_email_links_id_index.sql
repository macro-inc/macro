-- no-transaction

-- Supports the ON DELETE CASCADE from email_links: without this, each link
-- deletion seq-scans calendar_backfill_jobs while holding the email_links
-- row lock.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_backfill_jobs_email_link_id
    ON calendar_backfill_jobs (email_link_id);
