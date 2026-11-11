-- Agent teammates: an AI member of a team with its own Macro account, a
-- Macro computer that runs its brain, and a durable workspace repository.
-- Owned by crates/team_agents and crates/agent_git.

SET LOCAL lock_timeout = '5s';

-- Existing tables: additive, metadata-only changes (nullable columns or
-- constant defaults; no rewrite).

-- A membership that never bills a seat: an agent teammate's seat is included
-- with the team, so seat billing and plan changes skip it.
ALTER TABLE public.team_user
    ADD COLUMN seat_included BOOLEAN NOT NULL DEFAULT FALSE;

-- The agent a Macro computer runs, if any. hosted_runtimes knows only this
-- link; the persona lives in team_agents. Deleting the account leaves the
-- computer to its normal release.
ALTER TABLE public.hosted_runtime
    ADD COLUMN agent_user_id TEXT REFERENCES "User" (id) ON DELETE SET NULL;

-- One computer per agent. hosted_runtime is small and new, so a plain index
-- build is brief.
CREATE UNIQUE INDEX hosted_runtime_agent_user_idx ON public.hosted_runtime (agent_user_id)
    WHERE agent_user_id IS NOT NULL;

-- New tables.

-- An agent teammate. The account (`User`) and its team membership
-- (`team_user`) are ordinary; this row marks the account as a team agent and
-- holds what seeds its workspace. Deleting the account or the team deletes it.
CREATE TABLE team_agents (
    user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    created_by TEXT REFERENCES "User" (id) ON DELETE SET NULL,
    -- {name, job_description, personality, creator_id}: non-secret inputs the
    -- brain's first run writes into the workspace repository.
    persona_seed JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX team_agents_team_id_idx ON team_agents (team_id);
CREATE INDEX team_agents_created_by_idx ON team_agents (created_by);

-- An agent's workspace repository on agent_git_service. Only the token's hash
-- is stored; the plaintext is handed to the computer at enrollment.
CREATE TABLE agent_repos (
    agent_user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    size_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_push_at TIMESTAMPTZ
);

CREATE INDEX agent_repos_team_id_idx ON agent_repos (team_id);
