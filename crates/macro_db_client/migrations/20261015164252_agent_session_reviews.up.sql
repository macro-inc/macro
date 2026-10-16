SET LOCAL lock_timeout = '5s';
CREATE TABLE agent_session_review (
    id UUID PRIMARY KEY,
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    execution_id UUID NOT NULL REFERENCES agent_code_execution(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 0,
    record JSONB NOT NULL
);
CREATE INDEX agent_session_review_execution ON agent_session_review (agent_session_id, execution_id);
