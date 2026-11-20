-- no-transaction
-- Running jobs only, a few hundred rows at most: the per-account cap and the
-- sweep of jobs a stopped replica left past their deadline.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_code_execution_running_jobs_idx
    ON agent_code_execution (job_deadline)
    WHERE job_deadline IS NOT NULL AND job_settled_at IS NULL;
