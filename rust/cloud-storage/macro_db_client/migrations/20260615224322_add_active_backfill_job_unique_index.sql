-- At most one active (Init/InProgress) backfill job per link, so concurrent connects can
-- rely on ON CONFLICT instead of a racy check-then-insert. A one-off cleanup that resolves
-- any pre-existing duplicate active jobs is deployed ahead of this migration.
CREATE UNIQUE INDEX uq_active_backfill_job_per_link
    ON email_backfill_jobs (link_id)
    WHERE status IN ('Init', 'InProgress');
