-- Reverses 20260821165917_persona_bots.
--
-- Dropping the table takes its seeded rows with it, so the Macro Coder config
-- needs no separate delete.
DROP TABLE IF EXISTS public.bot_agent_config;

DROP INDEX IF EXISTS bots_system_global_handle_unique;
DROP INDEX IF EXISTS bots_persona_handle_unique;

-- Back to a system bot carrying no owner of any kind. Any team-scoped
-- persona rows have to go first, or the restored constraint rejects them.
DELETE FROM public.bots WHERE kind = 'system' AND team_id IS NOT NULL;

ALTER TABLE public.bots DROP CONSTRAINT bots_kind_owner_check;
ALTER TABLE public.bots ADD CONSTRAINT bots_kind_owner_check CHECK (
    (
        kind = 'owned'
        AND ((owner_user_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1)
    )
    OR (
        kind = 'system'
        AND owner_user_id IS NULL
        AND team_id IS NULL
    )
);
