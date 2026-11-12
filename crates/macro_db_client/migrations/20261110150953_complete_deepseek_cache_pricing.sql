-- Fireworks serverless, verified 2026-11-11: $0.006 per million cached input
-- tokens. Preserve operator-supplied rates and existing priced usage.
-- https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash-1017
SET LOCAL lock_timeout = '5s';

UPDATE ai_pricing
SET price_per_million_cache_read = 0.006,
    updated_at = NOW()
WHERE model = 'deepseek-v4p1-flash-1017'
  AND price_per_million_cache_read IS NULL;

-- Resolve previously unpriced calls using the effective (discounted) rates.
-- This does not change credit-ledger entries or issue refunds.
UPDATE ai_usage AS usage
SET price_per_million_in = pricing.price_per_million_in,
    price_per_million_out = pricing.price_per_million_out,
    price_per_million_cache_read = pricing.price_per_million_cache_read,
    price_per_million_cache_write = pricing.price_per_million_cache_write,
    total = usage.input_tokens::real / 1000000.0 * pricing.price_per_million_in
          + usage.output_tokens::real / 1000000.0 * pricing.price_per_million_out
          + usage.cache_read_input_tokens::real / 1000000.0 * pricing.price_per_million_cache_read
          + usage.cache_write_input_tokens::real / 1000000.0 * COALESCE(pricing.price_per_million_cache_write, 0)
FROM ai_effective_pricing AS pricing
WHERE usage.model = 'deepseek-v4p1-flash-1017'
  AND pricing.model = usage.model
  AND usage.total IS NULL
  AND pricing.price_per_million_cache_read IS NOT NULL
  AND (usage.cache_write_input_tokens = 0 OR pricing.price_per_million_cache_write IS NOT NULL);
