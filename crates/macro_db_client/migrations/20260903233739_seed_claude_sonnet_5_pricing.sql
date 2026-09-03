-- Seed Claude Sonnet 5 pricing (USD per million tokens). ON CONFLICT keeps
-- values adjusted at runtime through the pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out)
VALUES ('claude-sonnet-5', 2.0, 10.0)
ON CONFLICT (model) DO NOTHING;
