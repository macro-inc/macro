-- Retain all existing states while allowing failed turns in the list projection.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session
    DROP CONSTRAINT agent_session_turn_state_valid,
    ADD CONSTRAINT agent_session_turn_state_valid
    CHECK (turn_state IN ('idle', 'starting', 'running', 'stopping', 'blocked', 'disconnected', 'failed')) NOT VALID;
