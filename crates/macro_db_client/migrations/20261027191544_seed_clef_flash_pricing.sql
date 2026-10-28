-- Seed pricing for Cloudflare Workers AI's Clef Flash decision model (USD per
-- million tokens), which picks Chat or Code for the composer's Auto mode.
-- Cloudflare charges $0.038 per million input tokens and nothing for output.
-- Usage is recorded under the requested model id, `clef-flash`. ON CONFLICT
-- keeps any price already set at runtime via the set_pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('clef-flash', 0.038, 0)
ON CONFLICT (model) DO NOTHING;
