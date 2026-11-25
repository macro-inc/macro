-- The dev runner records one request; the harness operator holds the computer
-- until that request finishes. Unverified recovery needs an image upgrade.
SET LOCAL lock_timeout = '3s';

CREATE TABLE agent_runtime_update (
    id UUID PRIMARY KEY,
    computer_id UUID NOT NULL REFERENCES hosted_runtime(id) ON DELETE CASCADE,
    version TEXT NOT NULL CHECK (version ~ '^[0-9a-f]{40}$'),
    digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    source_url TEXT,
    deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '65 minutes'),
    lease_until TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_holder UUID,
    settle_failures SMALLINT NOT NULL DEFAULT 0,
    cleared_at TIMESTAMPTZ,
    outcome TEXT CHECK (outcome IN ('applied', 'refused', 'rolled_back', 'rollback_failed', 'expired', 'needs_operator')),
    CHECK ((outcome IS NULL) = (source_url IS NOT NULL))
);

-- A computer deletion cascades through finished history as well.
CREATE INDEX agent_runtime_update_computer ON agent_runtime_update (computer_id);
CREATE UNIQUE INDEX agent_runtime_update_unsettled_computer
    ON agent_runtime_update (computer_id)
    WHERE outcome IS NULL OR (outcome = 'needs_operator' AND cleared_at IS NULL);
CREATE INDEX agent_runtime_update_due
    ON agent_runtime_update (lease_until, id) WHERE outcome IS NULL;
