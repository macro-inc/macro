-- Personas: named, team-scoped, agent-backed system bots.
--
-- A persona is a `bots` row with kind='system' and a team_id: we host it and
-- run its sandbox (unlike kind='owned', which is customer-hosted and
-- authenticates inbound with a token), but a team names it, writes its system
-- prompt, and may edit it.
--
-- Ordered after 20260818220644_new_ai_agents, which creates the Macro Coder
-- bot this seeds a config row for. The two crossed over while this branch was
-- open, so the seed below has a foreign key that only resolves afterwards.

-- kind='system' previously forbade any owner at all, which made a team-scoped
-- system bot impossible. A system bot may now carry a team_id; it still may
-- never carry an owner_user_id, because we host it on the team's behalf.
ALTER TABLE public.bots DROP CONSTRAINT bots_kind_owner_check;
ALTER TABLE public.bots ADD CONSTRAINT bots_kind_owner_check CHECK (
    (
        kind = 'owned'
        AND ((owner_user_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1)
    )
    OR (
        kind = 'system'
        AND owner_user_id IS NULL
    )
);

-- Handles are user-minted from here on, so they need to be unique among the
-- bots a given mention menu shows. Both indexes are scoped to kind='system':
-- owned-bot handles have never been unique and backfilling that constraint
-- could fail on existing rows.
CREATE UNIQUE INDEX bots_persona_handle_unique
    ON public.bots (team_id, handle)
    WHERE kind = 'system' AND deleted_at IS NULL;

-- NULLs compare distinct, so the index above does not constrain the ownerless
-- first-party bots. They share one global handle namespace.
CREATE UNIQUE INDEX bots_system_global_handle_unique
    ON public.bots (handle)
    WHERE kind = 'system' AND team_id IS NULL AND deleted_at IS NULL;

-- What an agent-backed bot runs: its harness, its model, the instructions
-- prepended to every session, and the repository to check out.
--
-- Keyed on bot_id rather than a surrogate id, and separate from `bots` so the
-- ordinary owned-bot path is untouched. This is also the row that future
-- per-persona MCP server links will hang off.
CREATE TABLE public.bot_agent_config (
    bot_id        uuid PRIMARY KEY REFERENCES public.bots(id) ON DELETE CASCADE,
    harness       text NOT NULL DEFAULT 'opencode',
    model         text NOT NULL DEFAULT 'claude',
    -- Markdown, written verbatim into the sandbox and named in opencode's
    -- `instructions`. NULL means the persona adds nothing to the base prompt.
    system_prompt text,
    -- NULL means no checkout: the session gets an empty workspace. There is
    -- deliberately no deployment-wide default to fall back to.
    repo_url      text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Give the existing "Macro Coder" bot the config it has been running with as
-- deployment configuration, so it becomes an ordinary persona rather than a
-- special case. These mirror the agent_harness_service defaults it is
-- deployed with today; seeding NULL here would silently drop its checkout.
INSERT INTO public.bot_agent_config (bot_id, harness, model, repo_url)
VALUES (
    '00000000-0000-0000-0000-00000000a9e7',
    'opencode',
    'claude',
    'https://github.com/macro-inc/macro'
)
ON CONFLICT (bot_id) DO NOTHING;

-- `agent_session.repo_url` becomes nullable in its own migration
-- (20260819214239_agent_session_repo_url_nullable), which landed on main
-- while this branch was open. A session may now run without a checkout; the
-- repo it resolved to stays a recorded fact per session rather than being
-- read back off the persona, so editing a persona never rewrites the history
-- of what a past session actually cloned.
