-- What new coding-agent sessions for this user are told to do beyond their
-- assignment. A missing row is every preference off.
CREATE TABLE user_agent_coding_preferences (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    create_tasks BOOLEAN NOT NULL DEFAULT false,
    open_pull_requests BOOLEAN NOT NULL DEFAULT false,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
