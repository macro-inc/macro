-- Separate from the replacement so the scan holds no exclusive lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session_source VALIDATE CONSTRAINT agent_session_source_kind_fields;
