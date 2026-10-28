-- Prospective activation facts only. Never backfill/reprice historical usage.
-- These audit records deliberately have no membership/user cascade: departure
-- and cancellation must not destroy the rollout baseline or financial attribution.
CREATE TABLE ai_billing_usage_rollout (
    policy TEXT PRIMARY KEY CHECK (policy = 'public_allowance_v1'),
    configuration JSONB NOT NULL
);

CREATE TABLE ai_billing_usage_eligibility (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    identity JSONB NOT NULL,
    state JSONB NOT NULL,
    PRIMARY KEY (user_id, subscription_id, item_id)
);

CREATE TABLE ai_billing_usage_observation (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    facts JSONB NOT NULL,
    decision JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id, subscription_id, item_id)
);
-- Operational review of quarantined bindings and replayed/delayed events.
CREATE INDEX ai_billing_usage_observation_subscription
    ON ai_billing_usage_observation (subscription_id, created_at);

