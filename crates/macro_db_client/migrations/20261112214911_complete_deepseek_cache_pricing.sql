-- Fireworks serverless, verified 2026-11-11: $0.006 per million cached input
-- tokens. Preserve operator-supplied rates and existing priced usage.
-- https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash-1017
SET LOCAL lock_timeout = '5s';

UPDATE ai_pricing
SET price_per_million_cache_read = 0.006,
    updated_at = NOW()
WHERE model = 'deepseek-v4p1-flash-1017'
  AND price_per_million_cache_read IS NULL;

-- Historical usage repricing belongs in a separate batched operation.
-- This migration does not rewrite ai_usage or change credit-ledger entries.
