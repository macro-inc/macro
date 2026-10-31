-- Cloudflare Clairic preview: https://developers.cloudflare.com/workers-ai/models/clairic/
-- USD per million input tokens, with no output charge. Usage model IDs are
-- normalized to their final path component. Preserve runtime pricing overrides.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('clairic', 0.10, 0)
ON CONFLICT (model) DO NOTHING;
