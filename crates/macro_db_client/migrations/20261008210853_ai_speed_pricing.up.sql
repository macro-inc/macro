-- USD per million tokens, verified 2026-10-08:
-- https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast
-- https://platform.claude.com/docs/en/about-claude/pricing
-- Speed keys are accounting identities only; providers receive the real model id.
-- :long applies above 272,000 inclusive prompt tokens for each OpenAI request.
-- Claude cache writes use the existing 5-minute TTL. Opus 5.5 cache reads are 5%.
INSERT INTO ai_pricing (
    model, price_per_million_in, price_per_million_out,
    price_per_million_cache_read, price_per_million_cache_write
) VALUES
    ('gpt-6.1-sol', 2, 10, 0.10, 2.50),
    ('gpt-6.1-sol:long', 4, 15, 0.20, 5),
    ('gpt-6.1-sol:ultrafast', 12, 60, 0.60, 15),
    ('gpt-6.1-sol:ultrafast:long', 24, 90, 1.20, 30),
    ('gpt-6-astra:long', 20, 75, 2, 25),
    ('gpt-6-astra:ultrafast', 60, 300, 6, 75),
    ('gpt-6-astra:ultrafast:long', 120, 450, 12, 150),
    ('claude-opus-5-5:fast', 8, 40, 0.40, 10)
ON CONFLICT (model) DO NOTHING;
