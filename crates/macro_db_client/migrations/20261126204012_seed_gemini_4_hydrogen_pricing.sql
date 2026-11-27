-- Seed pricing for Gemini 4 Hydrogen (USD per million tokens), which replaces
-- Gemini 3.8 Flash in the Macro agent and chat catalogs. Standard paid-tier
-- rates from https://aistudio.google.com/docs/pricing (2026-11-26): $1.50 in,
-- $7.50 out (thinking tokens included), $0.075 context-cache reads, no long
-- context tier and no scheduled change. Implicit caching has no write charge.
-- ON CONFLICT keeps a price already set at runtime through set_pricing.
INSERT INTO ai_pricing (
    model, price_per_million_in, price_per_million_out, price_per_million_cache_read
) VALUES
    ('gemini-4-hydrogen', 1.50, 7.50, 0.075)
ON CONFLICT (model) DO NOTHING;
