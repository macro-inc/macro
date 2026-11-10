-- The model configuration each paired runtime last reported, so its agents
-- stay editable while the machine is off. Owned by agent_harness_service.
CREATE TABLE harness_known_models (
    harness_id UUID PRIMARY KEY REFERENCES harnesses (id) ON DELETE CASCADE,
    options JSONB NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL
);
