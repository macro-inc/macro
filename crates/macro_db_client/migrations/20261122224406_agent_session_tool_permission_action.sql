-- Agent permissions: a session's overlay (an agent's restrictions on itself
-- for one session) may hold an action's default (`action`, 'send') as well as
-- a group's action and an operation, as `agent_permission_rule` already may.
-- Only restrictions, so `state` keeps refusing 'always'.
--
-- Postgres named the inline checks of 20261120234700: the kind check
-- `agent_session_tool_permission_kind_check` and the target check, which
-- reads two columns, `agent_session_tool_permission_check`. The new checks
-- are added NOT VALID (no scan under this ALTER's exclusive lock);
-- 20261122224441 validates them in its own transaction. The table is small
-- and used only behind the agent permissions flag.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session_tool_permission
    DROP CONSTRAINT agent_session_tool_permission_kind_check,
    DROP CONSTRAINT agent_session_tool_permission_check,
    ADD CONSTRAINT agent_session_tool_permission_kind_check
    CHECK (kind IN ('action', 'group_action', 'tool')) NOT VALID,
    ADD CONSTRAINT agent_session_tool_permission_target_check CHECK (
        (kind = 'action' AND target ~ '^(create|read|update|destroy|send)$')
        OR (kind = 'group_action' AND target ~ '^[a-z_]+:(create|read|update|destroy|send)$')
        OR (kind = 'tool' AND target ~ '^[a-z_-]+\.[A-Za-z0-9_-]+$')
    ) NOT VALID;
