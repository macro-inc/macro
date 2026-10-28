-- Seed Fireworks serverless prices (USD per million tokens) for DeepSeek V4.1
-- Flash, which replaces DeepSeek V4 Pro in the Macro agent catalog: Fireworks
-- no longer serves deepseek-v4-pro-0813 serverless. Source:
-- https://fireworks.ai/models (2026-10-20). ON CONFLICT preserves prices
-- managed at runtime through set_pricing.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('deepseek-v4p1-flash-1017', 0.30, 1.20)
ON CONFLICT (model) DO NOTHING;
