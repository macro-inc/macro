-- Seed pricing for Claude Opus 5.5 (USD per million tokens), which chat and the
-- agent already use: its ai_usage rows recorded a NULL total without this row.
--
-- https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-06:
-- $4 base input, $20 output, $5 5m cache writes (1.25x input), $0.20 cache hits.
-- Opus 5.5 reads are 0.05x input, not the usual 0.1x. ON CONFLICT keeps any
-- price already set at runtime via the set_pricing endpoint.
INSERT INTO ai_pricing (
    model,
    price_per_million_in,
    price_per_million_out,
    price_per_million_cache_read,
    price_per_million_cache_write
) VALUES
    ('claude-opus-5-5', 4.0, 20.0, 0.20, 5.0)
ON CONFLICT (model) DO NOTHING;
