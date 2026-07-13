-- Add migration script here
CREATE TABLE IF NOT EXISTS scheduled_action
(
    id          UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    owner       TEXT        NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    schedule    TEXT        NOT NULL,
    kind        TEXT        NOT NULL,
    timezone    TEXT        NOT NULL,
    task        JSONB       NOT NULL,
    claimed     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_run_at TIMESTAMPTZ NOT NULL,
    enabled     BOOLEAN     NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduled_action_owner_idx
    ON scheduled_action (owner);

CREATE TABLE IF NOT EXISTS action_execution_record
(
    id          UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    action_id   UUID        NOT NULL REFERENCES scheduled_action (id) ON DELETE CASCADE,
    resource_id TEXT,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    is_success  BOOLEAN     NOT NULL,
    result      JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_execution_record_action_id_idx
    ON action_execution_record (action_id, start_time DESC);
