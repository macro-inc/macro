-- Seed standard-tier Fireworks serverless prices (USD per million tokens)
-- for the additional open-weight models advertised by the Macro agent.
-- ON CONFLICT preserves prices managed at runtime through set_pricing.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('glm-5p3', 1.40, 4.40),
    ('glm-5p3-flash', 0.15, 0.50),
    ('qwen3p8-max', 2.00, 6.00),
    ('minimax-m3', 0.30, 1.20),
    ('nemotron-lightning-3p5-30b-a3b', 0.05, 0.20)
ON CONFLICT (model) DO NOTHING;
-- Add migration script here
