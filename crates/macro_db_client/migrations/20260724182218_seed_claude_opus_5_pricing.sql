-- Seed pricing for Claude Opus 5 (USD per million tokens), which replaces
-- Claude Opus 4.8 in the chat model selector. Same price as Opus 4.8 per the
-- Claude pricing catalog. ON CONFLICT keeps any price already set at runtime
-- via the set_pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('claude-opus-5', 5.0, 25.0)
ON CONFLICT (model) DO NOTHING;
