-- Macro computers' warm pool: booted, enrolled computers that no team owns
-- yet, so a purchase can take one instead of creating a guest. A pool
-- computer has no team, buyer, purchase key, price or comp reason; buying it
-- fills them in, and it never goes back to the pool.
--
-- With no team, every team-scoped read (`team_id = $1`) skips pool rows, and
-- `harness_access_level` gives nobody access to a pool computer's harness
-- (its `JOIN team` finds no row), so no agent can bind to it or run on it.

SET LOCAL lock_timeout = '5s';

ALTER TABLE hosted_runtime
    ALTER COLUMN team_id DROP NOT NULL,
    ALTER COLUMN created_by DROP NOT NULL,
    ALTER COLUMN purchase_key DROP NOT NULL;

-- Ownership comes all together or not at all; a pool computer is never
-- priced or comped.
ALTER TABLE hosted_runtime ADD CONSTRAINT hosted_runtime_pool_check CHECK (
    (team_id IS NULL) = (created_by IS NULL)
    AND (team_id IS NULL) = (purchase_key IS NULL)
    AND (team_id IS NOT NULL OR (price_id IS NULL AND comp_reason IS NULL))
) NOT VALID;
ALTER TABLE hosted_runtime VALIDATE CONSTRAINT hosted_runtime_pool_check;

-- Purchases look for a pool computer of a size on a host.
CREATE INDEX hosted_runtime_pool_idx ON hosted_runtime (host_id, size)
    WHERE team_id IS NULL;

-- A taken pool computer runs before its charge settles; a team has at most
-- one such unpaid computer at a time.
CREATE UNIQUE INDEX hosted_runtime_charging_team_idx ON hosted_runtime (team_id)
    WHERE (state->'billing'->>'billing') = 'charging';

-- The image the host's operator creates computers from, written when it
-- registers. Purchases only take pool computers created from it.
ALTER TABLE hosted_runtime_host ADD COLUMN image TEXT;
