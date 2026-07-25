-- Deferred CRM cleanup: deduped (link_id, contact_email) pairs written on message
-- delete, swept by a nightly job instead of per-delete depopulate messages.
CREATE TABLE IF NOT EXISTS crm_cleanup_candidates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id UUID NOT NULL REFERENCES email_links (id) ON DELETE CASCADE,
    contact_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_cleanup_candidate
    ON crm_cleanup_candidates (link_id, contact_email);

DO $$
BEGIN
    CREATE TYPE crm_cleanup_job_status AS ENUM ('Init', 'InProgress', 'Complete', 'Failed');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS crm_cleanup_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status crm_cleanup_job_status NOT NULL DEFAULT 'Init',
    total_candidates BIGINT NOT NULL,
    dispatched_count BIGINT NOT NULL DEFAULT 0,
    -- MAX(crm_cleanup_candidates.id) at kickoff; the job only processes ids <= this
    max_candidate_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active cleanup job at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_crm_cleanup_job
    ON crm_cleanup_jobs ((TRUE))
    WHERE status IN ('Init', 'InProgress');
