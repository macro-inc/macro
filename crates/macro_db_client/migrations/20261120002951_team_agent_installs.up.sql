-- Agent teammates hosted on their owner's own machine (macrod) instead of a
-- Macro computer. Both tables are new; the foreign keys lock the referenced
-- tables against writes only for this short file.
SET LOCAL lock_timeout = '5s';

-- One install per agent: the primary key is the agent, so a second install
-- for the same agent loses. A move makes a new install id; a new image or a
-- credential rotation a new generation. Removing the agent's seat removes
-- its install.
CREATE TABLE team_agent_installs (
    agent_user_id TEXT PRIMARY KEY REFERENCES team_agents (user_id) ON DELETE CASCADE,
    install_id UUID NOT NULL UNIQUE,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    harness_id UUID NOT NULL REFERENCES harnesses (id) ON DELETE CASCADE,
    generation BIGINT NOT NULL CHECK (generation > 0),
    -- Where the machine last said the install's container is, for the
    -- current generation; `pending` until it says anything. `rolled_back`:
    -- the new image failed and the previous one runs.
    run_state TEXT NOT NULL DEFAULT 'pending' CHECK (
        run_state IN (
            'pending', 'downloading', 'starting', 'running', 'restarting', 'stopped',
            'rolled_back', 'failed'
        )
    ),
    failure TEXT CHECK (
        failure IN (
            'image_unavailable', 'image_mismatch', 'engine_refused',
            'bad_configuration', 'incompatible_runtime', 'crash_loop', 'host_unsupported',
            'network_isolation_unavailable'
        )
    ),
    -- The runtime image id the latest delivery carried. When the image for
    -- the machine's architecture changes, the install gets a new generation.
    delivered_image_id TEXT,
    -- Mints of this generation's credentials so far. A delivery is
    -- (generation, delivery); the machine keeps the highest it has seen.
    delivery BIGINT NOT NULL DEFAULT 0 CHECK (delivery >= 0),
    -- The delivery the machine confirmed by reporting it starting or running.
    applied_generation BIGINT,
    applied_delivery BIGINT,
    -- The newest delivery of this generation the machine reported on, so a
    -- late report about an older one can't overwrite the state.
    reported_delivery BIGINT,
    -- A move or removal waiting for the machine to stop the agent (its last
    -- push) before its credentials are revoked.
    checkpoint TEXT CHECK (checkpoint IN ('moving', 'removing')),
    -- RESTRICT: a hard-deleted target must not silently drop the install;
    -- the move is finished or cancelled first.
    move_to_harness_id UUID REFERENCES harnesses (id) ON DELETE RESTRICT,
    checkpoint_started_at TIMESTAMPTZ,
    created_by TEXT REFERENCES "User" (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Why the machine gave up on the generation, or rolled its image back.
    CONSTRAINT team_agent_installs_failure_only_when_failed CHECK (
        (run_state IN ('failed', 'rolled_back')) = (failure IS NOT NULL)
    ),
    CONSTRAINT team_agent_installs_applied_pair CHECK (
        (applied_generation IS NULL) = (applied_delivery IS NULL)
    ),
    CONSTRAINT team_agent_installs_checkpoint_complete CHECK (
        (checkpoint IS NULL) = (checkpoint_started_at IS NULL)
        AND (checkpoint IS NOT DISTINCT FROM 'moving') = (move_to_harness_id IS NOT NULL)
    )
);

-- Delivery reads a machine's installs when it connects.
CREATE INDEX team_agent_installs_harness_id_idx ON team_agent_installs (harness_id);
CREATE INDEX team_agent_installs_move_to_harness_id_idx
    ON team_agent_installs (move_to_harness_id)
    WHERE move_to_harness_id IS NOT NULL;

-- The latest report a machine sent about hosting agent teammates (its
-- container engine, platform, hardware and problem), for the Invite dialog's
-- eligibility check.
CREATE TABLE harness_teammate_hosts (
    harness_id UUID PRIMARY KEY REFERENCES harnesses (id) ON DELETE CASCADE,
    report JSONB NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
