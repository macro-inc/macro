-- Native Gemini signatures are private runtime state. They never enter ACP
-- frames or the projected session log.
SET LOCAL lock_timeout = '1s';

CREATE TABLE agent_session_gemini_4_replay (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    replay JSONB NOT NULL CHECK (octet_length(replay::text) <= 1048576),
    PRIMARY KEY (agent_session_id, request_id)
);
