-- Validates the overlay checks 20261122224406 added NOT VALID, in a
-- transaction of its own: VALIDATE CONSTRAINT scans under a SHARE UPDATE
-- EXCLUSIVE lock, which blocks no reads or writes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session_tool_permission
    VALIDATE CONSTRAINT agent_session_tool_permission_kind_check;
ALTER TABLE agent_session_tool_permission
    VALIDATE CONSTRAINT agent_session_tool_permission_target_check;
