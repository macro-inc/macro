-- Whether new coding-agent sessions for this user carry the task-tracking
-- workflow in their instructions. A missing row is disabled.
CREATE TABLE user_agent_task_tracking (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
