-- Run after the location routines migration releases its exclusive locks.
SET LOCAL lock_timeout = '5s';

ALTER TABLE scheduled_action VALIDATE CONSTRAINT scheduled_action_trigger_shape_check;
ALTER TABLE scheduled_action VALIDATE CONSTRAINT scheduled_action_supported_triggers_check;
ALTER TABLE agent_session_source VALIDATE CONSTRAINT agent_session_source_routine_firing;
