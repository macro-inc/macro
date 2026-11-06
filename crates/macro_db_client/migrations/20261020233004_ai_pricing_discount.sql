-- Per-model discounts on AI pricing. Every price read goes through
-- ai_effective_pricing, which applies a model's input discount to its input,
-- cache and audio rates and its output discount to its output rate, so
-- usage is recorded and recomputed at the discounted price. Usage already
-- recorded keeps its price until set_pricing recomputes the model.
CREATE TABLE ai_pricing_discount (
    model TEXT PRIMARY KEY REFERENCES ai_pricing (model) ON DELETE CASCADE,
    input_discount_percent NUMERIC(5, 2) NOT NULL
        CHECK (input_discount_percent BETWEEN 0 AND 100),
    output_discount_percent NUMERIC(5, 2) NOT NULL
        CHECK (output_discount_percent BETWEEN 0 AND 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE VIEW ai_effective_pricing AS
SELECT
    p.model,
    (p.price_per_million_in::numeric * f.input)::real AS price_per_million_in,
    (p.price_per_million_out::numeric * f.output)::real AS price_per_million_out,
    (p.price_per_million_cache_read::numeric * f.input)::real AS price_per_million_cache_read,
    (p.price_per_million_cache_write::numeric * f.input)::real AS price_per_million_cache_write,
    (p.price_per_audio_minute::numeric * f.input)::real AS price_per_audio_minute
FROM ai_pricing p
LEFT JOIN ai_pricing_discount d ON d.model = p.model
CROSS JOIN LATERAL (
    SELECT
        1 - COALESCE(d.input_discount_percent, 0) / 100 AS input,
        1 - COALESCE(d.output_discount_percent, 0) / 100 AS output
) f;

-- Gemini 3.8 Flash at DeepSeek V4.1 Flash's price: $0.75 -> $0.30 in,
-- $3.75 -> $1.20 out.
INSERT INTO ai_pricing_discount (model, input_discount_percent, output_discount_percent)
SELECT model, 60, 68 FROM ai_pricing WHERE model = 'gemini-3.8-flash'
ON CONFLICT (model) DO NOTHING;
