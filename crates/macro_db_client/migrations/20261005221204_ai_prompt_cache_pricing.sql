-- Price prompt-cache reads and writes.
--
-- ai_usage.input_tokens now holds only UNCACHED input. Cache reads and cache
-- writes are their own dimensions with their own rates; the recorder
-- normalizes each provider so no token lands in two columns.
--
-- A NULL cache rate means "no published rate": a call that reports tokens in
-- that dimension stays unpriced (total NULL), exactly like a model with no
-- ai_pricing row. It is never priced at zero or at the input rate.
--
-- Deployed writers omit every new column: their rows keep zero cache tokens
-- and NULL cache rates, which is what they measured.
ALTER TABLE ai_pricing
    ADD COLUMN price_per_million_cache_read REAL
        CHECK (price_per_million_cache_read >= 0 AND price_per_million_cache_read < 'Infinity'::real),
    ADD COLUMN price_per_million_cache_write REAL
        CHECK (price_per_million_cache_write >= 0 AND price_per_million_cache_write < 'Infinity'::real);

ALTER TABLE ai_usage
    ADD COLUMN cache_read_input_tokens BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN cache_write_input_tokens BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN price_per_million_cache_read REAL
        CHECK (price_per_million_cache_read >= 0 AND price_per_million_cache_read < 'Infinity'::real),
    ADD COLUMN price_per_million_cache_write REAL
        CHECK (price_per_million_cache_write >= 0 AND price_per_million_cache_write < 'Infinity'::real);

-- Claude Sonnet 5.5 is already used by chat but had no price row, so its usage
-- recorded a NULL total. $2 in / $10 out per the Claude pricing page below.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('claude-sonnet-5-5', 2.0, 10.0)
ON CONFLICT (model) DO NOTHING;

-- Cache rates in USD per million tokens, checked 2026-10-05. Only rows that
-- exist are updated; models absent here keep NULL cache rates.
--
-- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
--   "5m cache writes" and "Cache hits and refreshes" columns. Writes are the
--   5-minute TTL (1.25x input), the only TTL the agent sends; usage does not
--   split 5m from 1h writes, so 1h caching must not be enabled without a
--   separate dimension. Fable 5.1 reads are 0.025x input ($0.25).
--   claude-3-7-sonnet, claude-3-5-sonnet, claude-3-opus and claude-3-haiku are
--   no longer listed, so they get no cache rates.
--
-- OpenAI: https://developers.openai.com/api/docs/pricing ("cached input" and
--   "cache writes" columns, short context) and
--   https://developers.openai.com/api/docs/guides/prompt-caching ("Cache writes
--   cost 1.25x the standard, uncached input-token rate" for GPT-5.6 and later;
--   earlier models have no cache-write charge, so no write rate).
--   gpt-5.6 and gpt-5.6-mini are no longer listed by id; their rates apply the
--   documented GPT-5.6 rule (reads 0.1x, writes 1.25x) to their seeded input
--   rate. gpt-5-mini is seeded at the gpt-5.4-mini tier, so it takes that
--   tier's cached rate. The -pro models offer no cached input.
--
-- Cerebras: https://inference-docs.cerebras.ai/capabilities/prompt-caching
--   "Input tokens, whether served from the cache or processed fresh, are
--   billed at the standard input token rate", so reads cost the input rate.
--
-- Fireworks: https://docs.fireworks.ai/serverless/pricing (input / cached
--   input / output). deepseek-v4-pro-0813 and muse-glimmer-30b are not in the
--   published table, so they get no cache rates.
--
-- Google: https://ai.google.dev/gemini-api/docs/pricing. Gemini 3.8 Flash
--   context-caching reads are $0.075 through 2026-12-31 and $0.15 from
--   2027-01-01 (apply that with set_pricing alongside the input increase).
--   Implicit caching has no write charge. Gemini 2.5 Flash Image lists no
--   cached rate.
UPDATE ai_pricing AS p
SET price_per_million_cache_read = r.cache_read,
    price_per_million_cache_write = r.cache_write,
    updated_at = NOW()
FROM (VALUES
    -- Anthropic
    ('claude-fable-5-1', 0.25::real, 12.50::real),
    ('claude-fable-5', 1.00::real, 12.50::real),
    ('claude-mythos-5', 1.00::real, 12.50::real),
    ('claude-opus-5', 0.50::real, 6.25::real),
    ('claude-opus-4-8', 0.50::real, 6.25::real),
    ('claude-opus-4-7', 0.50::real, 6.25::real),
    ('claude-opus-4-6', 0.50::real, 6.25::real),
    ('claude-opus-4-5', 0.50::real, 6.25::real),
    ('claude-opus-4-1', 1.50::real, 18.75::real),
    ('claude-opus-4-0', 1.50::real, 18.75::real),
    ('claude-sonnet-5-5', 0.20::real, 2.50::real),
    ('claude-sonnet-5', 0.20::real, 2.50::real),
    ('claude-sonnet-4-6', 0.30::real, 3.75::real),
    ('claude-sonnet-4-5', 0.30::real, 3.75::real),
    ('claude-sonnet-4-0', 0.30::real, 3.75::real),
    ('claude-haiku-4-5', 0.10::real, 1.25::real),
    ('claude-3-5-haiku', 0.08::real, 1.00::real),
    -- OpenAI
    ('gpt-6-astra', 1.00::real, 12.50::real),
    ('gpt-5.6', 0.50::real, 6.25::real),
    ('gpt-5.6-mini', 0.075::real, 0.9375::real),
    ('gpt-5.5', 0.50::real, NULL::real),
    ('gpt-5.4', 0.25::real, NULL::real),
    ('gpt-5.4-mini', 0.075::real, NULL::real),
    ('gpt-5.4-nano', 0.02::real, NULL::real),
    ('gpt-5.3-codex', 0.175::real, NULL::real),
    ('gpt-5-mini', 0.075::real, NULL::real),
    -- Cerebras
    ('gpt-oss-120b', 0.35::real, NULL::real),
    ('zai-glm-4.7', 2.25::real, NULL::real),
    -- Fireworks
    ('kimi-k3', 0.30::real, NULL::real),
    ('glm-5p3', 0.26::real, NULL::real),
    ('glm-5p3-flash', 0.03::real, NULL::real),
    ('qwen3p8-max', 0.25::real, NULL::real),
    ('minimax-m3', 0.06::real, NULL::real),
    ('nemotron-lightning-3p5-30b-a3b', 0.01::real, NULL::real),
    -- Google
    ('gemini-3.8-flash', 0.075::real, NULL::real)
) AS r(model, cache_read, cache_write)
WHERE p.model = r.model;
