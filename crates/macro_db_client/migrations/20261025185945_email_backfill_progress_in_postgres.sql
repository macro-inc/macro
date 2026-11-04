-- Additive schema; old jobs remain NULL and require explicit recovery.
-- Deploy with backfill consumers/publishers quiesced; see the recovery runbook.
SET lock_timeout = '5s';
ALTER TABLE email_backfill_jobs
    ADD COLUMN completed_threads integer,
    ADD COLUMN listed_threads integer NOT NULL DEFAULT 0,
    ADD COLUMN listing_complete boolean NOT NULL DEFAULT false,
    ADD COLUMN recovery_of uuid REFERENCES email_backfill_jobs (id) ON DELETE SET NULL;

-- Retain completed identities until the job itself is deleted. Missing state
-- is never evidence of completion. Priority and normal listing share identities.
CREATE TABLE email_backfill_thread_progress (
    backfill_job_id uuid NOT NULL REFERENCES email_backfill_jobs (id) ON DELETE CASCADE,
    thread_provider_id text NOT NULL,
    -- Historical receipt deliberately survives deletion of the email content.
    thread_id uuid,
    provider_missing boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    CHECK (completed_at IS NULL OR thread_id IS NOT NULL OR provider_missing),
    CHECK (NOT provider_missing OR thread_id IS NULL),
    PRIMARY KEY (backfill_job_id, thread_provider_id)
);

-- A page is also its replayable publication obligation. Retries use this exact
-- snapshot, republishing all thread operations and the continuation safely.
CREATE TABLE email_backfill_listing_pages (
    backfill_job_id uuid NOT NULL REFERENCES email_backfill_jobs (id) ON DELETE CASCADE,
    priority_pass boolean NOT NULL,
    page_token text NOT NULL,
    thread_provider_ids text[] NOT NULL,
    next_page_token text,
    PRIMARY KEY (backfill_job_id, priority_pass, page_token)
);
