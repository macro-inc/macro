SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_code_execution
    DROP COLUMN job_owner_id,
    DROP COLUMN job_deadline,
    DROP COLUMN job_cancel_requested_at,
    DROP COLUMN job_settled_at;
