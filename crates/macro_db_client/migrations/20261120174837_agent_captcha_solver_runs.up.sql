-- Agent teammates' CAPTCHA solver runs and their CapSolver solves. A run is
-- the budget every Fireworks call and every solve is taken from; the solve
-- rows are the idempotency record and the per-agent solve caps. Both are
-- counted here, not per process, so replicas and deploys share them. A
-- deleted agent takes its rows with it.
CREATE TABLE agent_captcha_runs (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    model_calls_used INTEGER NOT NULL DEFAULT 0 CHECK (model_calls_used >= 0),
    model_calls_in_flight INTEGER NOT NULL DEFAULT 0 CHECK (model_calls_in_flight >= 0),
    solves_used INTEGER NOT NULL DEFAULT 0 CHECK (solves_used >= 0)
);
-- The per-agent run windows (concurrent, hourly, daily), and the cascade.
CREATE INDEX agent_captcha_runs_user_created ON agent_captcha_runs (user_id, created_at);

CREATE TABLE agent_captcha_solves (
    solve_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES agent_captcha_runs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    -- The answer a repeated solveId replays; set with finished_at.
    outcome JSONB,
    -- CapSolver's task id, once a task was created.
    task_id TEXT,
    CHECK ((finished_at IS NULL) = (outcome IS NULL))
);
-- The per-agent solve windows (concurrent, hourly, daily), and the cascade.
CREATE INDEX agent_captcha_solves_user_created ON agent_captcha_solves (user_id, created_at);
-- The cascade from a deleted run.
CREATE INDEX agent_captcha_solves_run ON agent_captcha_solves (run_id);
