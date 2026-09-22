-- Seed Claude Opus 5.5 pricing (USD per million tokens).
-- Preserve any pricing already configured through the set_pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('claude-opus-5-5', 4.0, 20.0)
ON CONFLICT (model) DO NOTHING;
