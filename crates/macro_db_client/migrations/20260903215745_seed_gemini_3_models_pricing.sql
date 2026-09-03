-- Seed standard paid-tier pricing for the Gemini models offered by the
-- in-memory agent (USD per million tokens). Gemini 3.1 Pro has higher rates
-- above 200k input tokens; ai_pricing currently supports one flat rate, so
-- this records the <=200k rate used by ordinary sessions.
--
-- Gemini 3.8 Flash's introductory pricing expires after 2026-12-31. The
-- runtime pricing endpoint can update this row without another migration.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('gemini-3.8-flash', 0.75, 3.75),
    ('gemini-3.1-pro-preview', 2.0, 12.0)
ON CONFLICT (model) DO NOTHING;
