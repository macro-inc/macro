CREATE TABLE agent_brain_job (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    id UUID NOT NULL,
    action_id UUID NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    work_date DATE NOT NULL,
    minutes SMALLINT NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
    repo_head_sha TEXT NOT NULL CHECK (repo_head_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    charter_sha256 TEXT NOT NULL CHECK (charter_sha256 ~ '^[0-9a-f]{64}$'),
    task_pack_id TEXT NOT NULL CHECK (task_pack_id <> ''),
    task_pack_revision TEXT NOT NULL CHECK (task_pack_revision <> ''),
    deadline_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    lease_holder UUID,
    lease_epoch BIGINT NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    outcome TEXT CHECK (outcome IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'unknown_outcome')),
    PRIMARY KEY (team_id, user_id, id),
    CHECK (lease_until <= deadline_at),
    CHECK (outcome IS NULL OR lease_holder IS NULL)
);

CREATE INDEX agent_brain_job_claim_idx
    ON agent_brain_job (team_id, user_id, lease_until, id)
    WHERE outcome IS NULL;

-- The action UUID is also the downstream entry ID. A receipt with no
-- confirmation is durable uncertainty. Deleting a downstream entry, task,
-- or agent must never clear that fence.
CREATE TABLE agent_brain_action_receipt (
    action_id UUID PRIMARY KEY REFERENCES agent_brain_job (action_id),
    dispatch_epoch BIGINT NOT NULL CHECK (dispatch_epoch > 0),
    confirmed_at TIMESTAMPTZ
);
