-- The ACP fold owns this projection. Null preserves "not projected yet" for
-- existing sessions instead of guessing activity from their last runtime event.
ALTER TABLE agent_session
    ADD COLUMN turn_state TEXT
    CONSTRAINT agent_session_turn_state_valid
    CHECK (turn_state IN ('idle', 'starting', 'running', 'stopping', 'blocked', 'disconnected'));
