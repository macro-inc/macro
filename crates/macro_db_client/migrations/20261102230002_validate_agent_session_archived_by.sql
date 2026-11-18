-- Run after the column migration releases its exclusive table lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session VALIDATE CONSTRAINT agent_session_archived_by_with_archived_at;
