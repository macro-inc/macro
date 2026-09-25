-- Seed Fireworks serverless prices (USD per million tokens) for the
-- open-weight models advertised on the in-memory Macro agent.
-- Standard-tier rates from Fireworks' serverless pricing page:
-- Kimi K3 $3 / $15, DeepSeek V4 Pro $1.32 / $3.96, Muse Glimmer $0.35 / $1.50.
-- ON CONFLICT keeps any price already set at runtime via set_pricing.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('kimi-k3', 3.0, 15.0),
    ('deepseek-v4-pro-0813', 1.32, 3.96),
    ('muse-glimmer-30b', 0.35, 1.50)
ON CONFLICT (model) DO NOTHING;
