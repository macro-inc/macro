-- USD per million tokens for the models that replace the retired chat models,
-- verified 2026-11-24:
-- https://platform.claude.com/docs/en/about-claude/pricing
-- https://developers.openai.com/api/docs/pricing
-- Speed keys are accounting identities only; providers receive the real model id.
-- :long applies per request above 272,000 inclusive prompt tokens for OpenAI
-- models and above 100,000 for Claude Haiku 5.5 (cache reads and writes count).
-- Claude cache writes use the 5-minute TTL; OpenAI cache writes the 30-minute one.
-- GPT-6.2 Sol Ultrafast is at OpenAI's introductory price (3x Standard) through
-- 2027-02-28; it doubles (6x) from 2027-03-01 and needs a new row before then.
INSERT INTO ai_pricing (
    model, price_per_million_in, price_per_million_out,
    price_per_million_cache_read, price_per_million_cache_write
) VALUES
    ('claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125),
    ('claude-haiku-5-5:long', 0.50, 2.50, 0.05, 0.625),
    ('gpt-6.2-sol', 2, 10, 0.10, 2.50),
    ('gpt-6.2-sol:long', 4, 15, 0.20, 5),
    ('gpt-6.2-sol:priority', 4, 20, 0.20, 5),
    ('gpt-6.2-sol:priority:long', 8, 30, 0.40, 10),
    ('gpt-6.2-sol:ultrafast', 6, 30, 0.30, 7.50),
    ('gpt-6.2-sol:ultrafast:long', 12, 45, 0.60, 15),
    ('gpt-6-luna', 0.10, 0.50, 0.01, 0.125),
    ('gpt-6-luna:long', 0.20, 0.75, 0.02, 0.25)
ON CONFLICT (model) DO NOTHING;
