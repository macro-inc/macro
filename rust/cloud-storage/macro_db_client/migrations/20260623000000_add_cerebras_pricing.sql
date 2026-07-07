-- Seed Cerebras model prices (USD per million tokens).
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('gpt-oss-120b', 0.35, 0.75),
    ('zai-glm-4.7',  2.25, 2.75)
ON CONFLICT DO NOTHING;
