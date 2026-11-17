-- Warm pool computers for agent teammates. A pool computer records which
-- guest it was created as: the regular one, or the agent-mode build an agent
-- teammate's computer runs. A purchase takes only its own kind. The host
-- records the agent image beside the regular one, so a pool computer built
-- from an older agent image is drained like a regular one.
--
-- hosted_runtime and hosted_runtime_host hold one row per computer and host
-- (tens of rows), so these run without CONCURRENTLY.

SET LOCAL lock_timeout = '5s';

CREATE TYPE public.hosted_runtime_pool_kind AS ENUM ('regular', 'agent');

-- NULL for computers that were never in the pool.
ALTER TABLE public.hosted_runtime ADD COLUMN pool_kind public.hosted_runtime_pool_kind;

-- Every pool computer so far was a regular one.
UPDATE public.hosted_runtime SET pool_kind = 'regular' WHERE team_id IS NULL;

ALTER TABLE public.hosted_runtime_host ADD COLUMN agent_image TEXT;
