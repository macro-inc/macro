-- Agent permissions under a stable policy id: one `agent_permission_policy`
-- row per policy (an owned agent's, a person's for a built-in persona, and,
-- later, a team's default) and its rules in `agent_permission_rule`, so
-- policies can later refer to each other by id. Rules keep the meaning of
-- `agent_tool_permission` / `persona_tool_permission`; `kind = 'action'` (an
-- action's default) is allowed here but not written yet.
--
-- The old tables stay, unread, until a cleanup after release; this copies
-- every row they hold (including the `channel_admin` copies the previous
-- migration made). Both new tables are new, so nothing waits on their locks;
-- the old ones are only read.
SET LOCAL lock_timeout = '5s';

CREATE TABLE agent_permission_policy (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('agent', 'persona', 'team')),
    -- An owned agent's policy dies with the agent.
    bot_id uuid REFERENCES bots (id) ON DELETE CASCADE,
    -- A person's policy for a built-in persona (which has no bots row: its id
    -- is a constant in crates/bot_id) dies with the person.
    user_id text REFERENCES "User" (id) ON DELETE CASCADE,
    persona_id uuid,
    -- A team's default policy dies with the team.
    team_id uuid REFERENCES team (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'agent') = (bot_id IS NOT NULL)),
    CHECK ((kind = 'persona') = (user_id IS NOT NULL AND persona_id IS NOT NULL)),
    CHECK ((kind = 'persona') = (user_id IS NOT NULL OR persona_id IS NOT NULL)),
    CHECK ((kind = 'team') = (team_id IS NOT NULL))
);

-- One policy per owner; each also serves its foreign key's deletes.
CREATE UNIQUE INDEX agent_permission_policy_agent_key ON agent_permission_policy (bot_id)
WHERE bot_id IS NOT NULL;
CREATE UNIQUE INDEX agent_permission_policy_persona_key ON agent_permission_policy (
    user_id, persona_id
)
WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX agent_permission_policy_team_key ON agent_permission_policy (team_id)
WHERE team_id IS NOT NULL;

-- A policy's saved settings: an action's default (`action`, 'send'), a
-- group's action (`group_action`, 'documents:destroy') or one SDK operation
-- (`tool`, 'storage.delete_document').
CREATE TABLE agent_permission_rule (
    policy_id uuid NOT NULL REFERENCES agent_permission_policy (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('action', 'group_action', 'tool')),
    target text NOT NULL CHECK (
        (kind = 'action' AND target ~ '^(create|read|update|destroy|send)$')
        OR (kind = 'group_action' AND target ~ '^[a-z_]+:(create|read|update|destroy|send)$')
        OR (kind = 'tool' AND target ~ '^[a-z_-]+\.[A-Za-z0-9_-]+$')
    ),
    state text NOT NULL CHECK (state IN ('always', 'ask', 'never')),
    -- 'always' is an action's default, so it is never stored there.
    CHECK (kind <> 'action' OR state <> 'always'),
    -- A user id is an email: it must not outlive the user.
    updated_by text REFERENCES "User" (id) ON DELETE SET NULL,
    -- The agent set it by restricting itself.
    via_agent boolean NOT NULL DEFAULT false,
    -- Not made by a signed-in person: it only restricts.
    restriction_only boolean NOT NULL DEFAULT false,
    CHECK (NOT via_agent OR restriction_only),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (policy_id, kind, target)
);

-- Deleting a person sets their `updated_by` to NULL; this keeps that a lookup.
CREATE INDEX agent_permission_rule_updated_by_idx ON agent_permission_rule (updated_by)
WHERE updated_by IS NOT NULL;

-- Backfill (agent_permissions' pg tests re-run everything from here).
-- Migration-local UUIDv7 generation for PostgreSQL 14 (uuidv7() needs PG18);
-- policies created later get their ids from the application.
CREATE FUNCTION pg_temp.policy_uuid() RETURNS uuid LANGUAGE sql VOLATILE AS $$
    SELECT encode(set_byte(set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112),
        8, (get_byte(bytes, 8) & 63) | 128), 'hex')::uuid
    FROM (SELECT overlay(gen_random_bytes(16) placing
        decode(lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0'), 'hex')
        FROM 1 FOR 6) AS bytes) random;
$$;

-- One policy per owner that has saved settings, then its rows, verbatim.
-- Idempotent, so a re-run adds only what is missing.
INSERT INTO agent_permission_policy (id, kind, bot_id)
SELECT pg_temp.policy_uuid(), 'agent', owners.bot_id
FROM (SELECT DISTINCT bot_id FROM agent_tool_permission) AS owners
ON CONFLICT DO NOTHING;

INSERT INTO agent_permission_policy (id, kind, user_id, persona_id)
SELECT pg_temp.policy_uuid(), 'persona', owners.user_id, owners.persona_id
FROM (SELECT DISTINCT user_id, persona_id FROM persona_tool_permission) AS owners
ON CONFLICT DO NOTHING;

INSERT INTO agent_permission_rule
    (policy_id, kind, target, state, updated_by, via_agent, restriction_only, updated_at)
SELECT policy.id, old.kind, old.target, old.state, old.updated_by, old.via_agent,
    old.restriction_only, old.updated_at
FROM agent_tool_permission AS old
INNER JOIN agent_permission_policy AS policy ON policy.bot_id = old.bot_id
ON CONFLICT DO NOTHING;

-- The persona table never recorded who made a row.
INSERT INTO agent_permission_rule
    (policy_id, kind, target, state, via_agent, restriction_only, updated_at)
SELECT policy.id, old.kind, old.target, old.state, old.via_agent, old.restriction_only,
    old.updated_at
FROM persona_tool_permission AS old
INNER JOIN agent_permission_policy AS policy
    ON policy.user_id = old.user_id AND policy.persona_id = old.persona_id
ON CONFLICT DO NOTHING;

DROP FUNCTION pg_temp.policy_uuid();
