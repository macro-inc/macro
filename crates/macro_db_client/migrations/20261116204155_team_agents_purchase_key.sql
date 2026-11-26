-- One agent teammate per invite: the Invite dialog's purchase key, resent on
-- every retry, so a double click or a retry after a lost answer finds the
-- first agent instead of creating a second account. Agents invited before
-- this have none; NULL keys never conflict.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.team_agents ADD COLUMN purchase_key TEXT;

-- team_agents is small (one row per agent teammate), so a plain index build
-- is brief. It also backs the lookup of an earlier invite by its key.
CREATE UNIQUE INDEX team_agents_purchase_key_idx ON public.team_agents (team_id, purchase_key);
