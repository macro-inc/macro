-- Run after the replacement migration releases its exclusive table lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session VALIDATE CONSTRAINT agent_session_turn_state_valid;
