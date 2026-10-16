CREATE TABLE agent_conversation_settings (
    session_id UUID PRIMARY KEY REFERENCES agent_conversation_sessions(session_id) ON DELETE CASCADE,
    settings JSONB NOT NULL
);
