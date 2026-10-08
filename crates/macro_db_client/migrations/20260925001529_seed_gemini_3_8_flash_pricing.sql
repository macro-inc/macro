-- Seed pricing for Gemini 3.8 Flash (USD per million tokens), offered on the
-- in-memory Macro agent. Standard-tier rates from Google's Gemini API pricing
-- page: $0.75 in / $3.75 out through 2026-12-31, rising to $1.50 / $7.50 on
-- 2027-01-01. ON CONFLICT keeps any price already set at runtime via the
-- set_pricing endpoint, which is also how the January increase gets applied.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('gemini-3.8-flash', 0.75, 3.75)
ON CONFLICT (model) DO NOTHING;
