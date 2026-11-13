-- Wake telemetry for agent accounts: the latest WakeRecord (v1, as muppet
-- sends it) per wake. A wake is recorded at `start`, again at `session`, and
-- last at `end`; a write only replaces a record of the same or an earlier
-- phase, so a retried `start` never overwrites an `end`.
--
-- `status` is `running` until the `end` record arrives, then how the wake
-- ended. The trace itself is a blob in object storage; `trace_updated_at`
-- says one has been uploaded.
SET LOCAL lock_timeout = '3s';

CREATE TABLE agent_wakes (
    agent_user_id    TEXT        NOT NULL REFERENCES "User" (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    wake_id          TEXT        NOT NULL,
    system           TEXT        NOT NULL,
    phase            SMALLINT    NOT NULL CHECK (phase BETWEEN 0 AND 2),
    status           TEXT        NOT NULL
        CHECK (status IN ('running', 'ok', 'failed', 'timeout', 'cancelled')),
    started_at       TIMESTAMPTZ NOT NULL,
    record           JSONB       NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_updated_at TIMESTAMPTZ,
    PRIMARY KEY (agent_user_id, wake_id)
);

-- An agent's wakes, newest first.
CREATE INDEX agent_wakes_agent_started_idx
    ON agent_wakes (agent_user_id, started_at DESC, wake_id DESC);

-- An agent's wakes in one status (running ones for liveness, failed ones),
-- newest first.
CREATE INDEX agent_wakes_agent_status_started_idx
    ON agent_wakes (agent_user_id, status, started_at DESC, wake_id DESC);
