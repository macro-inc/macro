-- The dev runner records one request; the harness operator holds the computer
-- until that request succeeds, rolls back, is refused, or expires.
SET LOCAL lock_timeout = '3s';

CREATE TABLE agent_runtime_update (
    id UUID PRIMARY KEY,
    computer_id UUID NOT NULL REFERENCES hosted_runtime(id) ON DELETE CASCADE,
    version TEXT NOT NULL CHECK (version ~ '^[0-9a-f]{40}$'),
    digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    source_url TEXT,
    deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '40 minutes'),
    lease_until TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_holder UUID,
    outcome TEXT CHECK (outcome IN ('applied', 'refused', 'rolled_back', 'rollback_failed', 'expired')),
    CHECK ((outcome IS NULL) = (source_url IS NOT NULL))
);

-- A computer deletion cascades through finished history as well.
CREATE INDEX agent_runtime_update_computer ON agent_runtime_update (computer_id);
CREATE UNIQUE INDEX agent_runtime_update_unfinished_computer
    ON agent_runtime_update (computer_id) WHERE outcome IS NULL;
CREATE INDEX agent_runtime_update_due
    ON agent_runtime_update (lease_until, id) WHERE outcome IS NULL;
