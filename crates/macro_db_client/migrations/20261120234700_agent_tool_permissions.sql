-- Agent permissions: which Macro SDK operations an agent's code may call
-- freely, only after asking, or never. Rows are sparse: only choices that
-- differ from the default are stored, and a missing row means "always".
--
-- `kind` and `target` encode what a row applies to: a group's action
-- (`group_action`, 'documents:destroy') or one SDK operation (`tool`,
-- 'storage.delete_document', service then operationId). The registry that
-- names the groups and operations is crates/agent_permission_registry.
-- All three tables are new, so nothing else waits on their locks.
SET LOCAL lock_timeout = '5s';

-- An owned agent's saved permissions. Rows die with the agent.
CREATE TABLE agent_tool_permission (
    bot_id uuid NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('group_action', 'tool')),
    target text NOT NULL CHECK (
        (kind = 'group_action' AND target ~ '^[a-z_]+:(create|read|update|destroy|send)$')
        OR (kind = 'tool' AND target ~ '^[a-z_-]+\.[A-Za-z0-9_-]+$')
    ),
    state text NOT NULL CHECK (state IN ('always', 'ask', 'never')),
    -- 'always' is a group action's default, so it is never stored there.
    CHECK (kind = 'tool' OR state <> 'always'),
    -- A user id is an email: it must not outlive the user.
    updated_by text REFERENCES "User" (id) ON DELETE SET NULL,
    -- The agent set it by restricting itself.
    via_agent boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, kind, target)
);

-- Deleting a person sets their `updated_by` to NULL; this keeps that a lookup.
CREATE INDEX agent_tool_permission_updated_by_idx ON agent_tool_permission (updated_by)
WHERE updated_by IS NOT NULL;

-- One person's permissions for a built-in persona, which has no bots row
-- (its id is a constant in crates/bot_id), applied to the sessions they own.
-- Rows die with the person.
CREATE TABLE persona_tool_permission (
    user_id text NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    persona_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('group_action', 'tool')),
    target text NOT NULL CHECK (
        (kind = 'group_action' AND target ~ '^[a-z_]+:(create|read|update|destroy|send)$')
        OR (kind = 'tool' AND target ~ '^[a-z_-]+\.[A-Za-z0-9_-]+$')
    ),
    state text NOT NULL CHECK (state IN ('always', 'ask', 'never')),
    CHECK (kind = 'tool' OR state <> 'always'),
    via_agent boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, persona_id, kind, target)
);

-- An agent's restrictions on itself for one session, when the person it acts
-- for may not edit the agent. Only restrictions, so never 'always'. Rows die
-- with the session.
CREATE TABLE agent_session_tool_permission (
    agent_session_id uuid NOT NULL REFERENCES agent_session (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('group_action', 'tool')),
    target text NOT NULL CHECK (
        (kind = 'group_action' AND target ~ '^[a-z_]+:(create|read|update|destroy|send)$')
        OR (kind = 'tool' AND target ~ '^[a-z_-]+\.[A-Za-z0-9_-]+$')
    ),
    state text NOT NULL CHECK (state IN ('ask', 'never')),
    set_by text REFERENCES "User" (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_session_id, kind, target)
);

-- Deleting a person sets their `set_by` to NULL; this keeps that a lookup.
CREATE INDEX agent_session_tool_permission_set_by_idx ON agent_session_tool_permission (set_by)
WHERE set_by IS NOT NULL;
