-- Background jobs: code executions that outlive their turn. NULL job_deadline
-- is a foreground execution. Nullable columns without defaults are metadata
-- only, so this does not rewrite the table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_code_execution
    ADD COLUMN job_owner_id TEXT,
    ADD COLUMN job_deadline TIMESTAMPTZ,
    ADD COLUMN job_cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN job_settled_at TIMESTAMPTZ;
