-- USD per million tokens, verified 2026-11-12:
-- https://developers.openai.com/api/docs/pricing (Fast tier; OpenAI's
-- priority processing, requested as service_tier "priority").
-- Speed keys are accounting identities only; providers receive the real model id.
-- :long applies above 272,000 inclusive prompt tokens for each OpenAI request.
-- Cache writes follow the existing 1.25x-input convention for these models.
INSERT INTO ai_pricing (
    model, price_per_million_in, price_per_million_out,
    price_per_million_cache_read, price_per_million_cache_write
) VALUES
    ('gpt-6.1-sol:priority', 4, 20, 0.20, 5),
    ('gpt-6.1-sol:priority:long', 8, 30, 0.40, 10),
    ('gpt-6-astra:priority', 20, 100, 2, 25),
    ('gpt-6-astra:priority:long', 40, 150, 4, 50)
ON CONFLICT (model) DO NOTHING;
