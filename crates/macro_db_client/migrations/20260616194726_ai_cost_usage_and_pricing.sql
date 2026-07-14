-- AI cost logging: per-completion usage rows and a per-model pricing table.

-- Per-model pricing, keyed by the raw model api id (e.g. "claude-opus-4-8").
-- Updated via the ai_cost set_pricing endpoint, which also recomputes the
-- price of every ai_usage row for that model.
CREATE TABLE ai_pricing (
    model TEXT PRIMARY KEY,
    price_per_million_in REAL NOT NULL,
    price_per_million_out REAL NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per completion round-trip. Price columns are nullable: when a model
-- has no entry in ai_pricing at record time, the price is left NULL and can be
-- backfilled later via set_pricing.
CREATE TABLE ai_usage (
    id UUID PRIMARY KEY,
    feature TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entity UUID,
    model TEXT NOT NULL,
    input_tokens BIGINT NOT NULL,
    output_tokens BIGINT NOT NULL,
    price_per_million_in REAL,
    price_per_million_out REAL,
    total REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_usage_created_at_idx ON ai_usage (created_at DESC);
CREATE INDEX ai_usage_feature_idx ON ai_usage (feature);
CREATE INDEX ai_usage_user_id_idx ON ai_usage (user_id);
CREATE INDEX ai_usage_model_idx ON ai_usage (model);

-- Seed known model prices (USD per million tokens). Unknown models record a
-- NULL price until corrected via the set_pricing endpoint.
--
-- Anthropic prices are from the Claude pricing catalog; OpenAI prices are from
-- OpenAI's published pricing page. Either can be corrected at runtime via
-- set_pricing.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    -- Anthropic
    ('claude-fable-5', 10.0, 50.0),
    ('claude-mythos-5', 10.0, 50.0),
    ('claude-opus-4-8', 5.0, 25.0),
    ('claude-opus-4-7', 5.0, 25.0),
    ('claude-opus-4-6', 5.0, 25.0),
    ('claude-opus-4-5', 5.0, 25.0),
    ('claude-opus-4-1', 15.0, 75.0),
    ('claude-opus-4-0', 15.0, 75.0),
    ('claude-sonnet-4-6', 3.0, 15.0),
    ('claude-sonnet-4-5', 3.0, 15.0),
    ('claude-sonnet-4-0', 3.0, 15.0),
    ('claude-haiku-4-5', 1.0, 5.0),
    ('claude-3-7-sonnet', 3.0, 15.0),
    ('claude-3-5-sonnet', 3.0, 15.0),
    ('claude-3-5-haiku', 0.8, 4.0),
    ('claude-3-opus', 15.0, 75.0),
    ('claude-3-haiku', 0.25, 1.25),
    -- OpenAI (per the OpenAI pricing page)
    ('gpt-5.5', 5.0, 30.0),
    ('gpt-5.5-pro', 30.0, 180.0),
    ('gpt-5.4', 2.5, 15.0),
    ('gpt-5.4-mini', 0.75, 4.5),
    ('gpt-5.4-nano', 0.2, 1.25),
    ('gpt-5.4-pro', 30.0, 180.0),
    ('gpt-5.3-codex', 1.75, 14.0),
    -- `gpt-5-mini` is the id this codebase emits for the fast OpenAI tier; it is
    -- not separately listed, so it is priced at the current mini tier.
    ('gpt-5-mini', 0.75, 4.5);
