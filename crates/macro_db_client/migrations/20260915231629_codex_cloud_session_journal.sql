CREATE TABLE codex_cloud_sessions (
    agent_session_id uuid PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    acp_session_id text NOT NULL,
    state jsonb NOT NULL
);
