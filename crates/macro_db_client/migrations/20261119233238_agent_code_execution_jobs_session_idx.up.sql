-- no-transaction
-- If this fails partway, CONCURRENTLY leaves an INVALID index that IF NOT
-- EXISTS then skips: run DROP INDEX CONCURRENTLY IF EXISTS agent_code_execution_jobs_session_idx;
-- before rerunning.
-- A session's jobs: its running-job cap and the job list in its prompts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_code_execution_jobs_session_idx
    ON agent_code_execution (agent_session_id, job_settled_at)
    WHERE job_deadline IS NOT NULL;
