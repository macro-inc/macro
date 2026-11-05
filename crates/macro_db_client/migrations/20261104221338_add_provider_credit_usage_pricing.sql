-- Add vendor credit billing (e.g. Tavily search/extract credits) alongside
-- token and audio billing; deployed writers can continue omitting every new
-- column.
ALTER TABLE ai_pricing
    ADD COLUMN price_per_provider_credit REAL
        CHECK (price_per_provider_credit >= 0 AND price_per_provider_credit < 'Infinity'::real);

ALTER TABLE ai_usage
    ADD COLUMN provider_credits BIGINT CHECK (provider_credits >= 0),
    ADD COLUMN price_per_provider_credit REAL
        CHECK (price_per_provider_credit >= 0 AND price_per_provider_credit < 'Infinity'::real);

-- The input discount covers credit rates, as it does cache and audio rates.
CREATE OR REPLACE VIEW ai_effective_pricing AS
SELECT
    p.model,
    (p.price_per_million_in::numeric * f.input)::real AS price_per_million_in,
    (p.price_per_million_out::numeric * f.output)::real AS price_per_million_out,
    (p.price_per_million_cache_read::numeric * f.input)::real AS price_per_million_cache_read,
    (p.price_per_million_cache_write::numeric * f.input)::real AS price_per_million_cache_write,
    (p.price_per_audio_minute::numeric * f.input)::real AS price_per_audio_minute,
    (p.price_per_provider_credit::numeric * f.input)::real AS price_per_provider_credit
FROM ai_pricing p
LEFT JOIN ai_pricing_discount d ON d.model = p.model
CROSS JOIN LATERAL (
    SELECT
        1 - COALESCE(d.input_discount_percent, 0) / 100 AS input,
        1 - COALESCE(d.output_discount_percent, 0) / 100 AS output
) f;

-- https://tavily.com/pricing — $0.008 per pay-as-you-go credit.
-- Preserve any rate already configured by an administrator.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_provider_credit)
VALUES ('tavily', 0, 0, 0.008)
ON CONFLICT (model) DO NOTHING;
