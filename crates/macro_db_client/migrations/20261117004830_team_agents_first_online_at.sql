-- When an agent teammate first reported itself online (POST
-- /team_agents/me/online). Until then an agent whose computer is up is
-- "starting", not "running", and its inviter isn't told it is ready.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.team_agents ADD COLUMN first_online_at TIMESTAMPTZ;

-- Agents invited before this run a workspace that never reports, so they
-- count as online from their invite. team_agents has one row per agent
-- teammate, so this touches few rows.
UPDATE public.team_agents SET first_online_at = created_at WHERE first_online_at IS NULL;
