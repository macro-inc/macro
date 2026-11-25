-- Steady-state Standard rates in USD per million tokens, shared by the
-- Gemini Developer API paid tier and Google Cloud's global endpoint.
-- Developer API Carbon pricing is $2.00 / $0.10 / $10.00 (input / cache read /
-- output) through November 30, 2026. The seeded Carbon rate starts December 1.
-- Google Cloud promotional credits are separate from Developer API pricing.
INSERT INTO ai_pricing (
    model, price_per_million_in, price_per_million_out, price_per_million_cache_read
) VALUES
    ('gemini-4-neon', 3.00, 15.00, 0.15),
    ('gemini-4-carbon', 4.00, 20.00, 0.20)
ON CONFLICT (model) DO NOTHING;
