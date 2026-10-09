CREATE TABLE agent_dm_settings (
    session_id UUID PRIMARY KEY REFERENCES agent_dm_conversations(session_id) ON DELETE CASCADE,
    settings JSONB NOT NULL
);
