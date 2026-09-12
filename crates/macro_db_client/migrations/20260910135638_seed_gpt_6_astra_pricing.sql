-- Seed pricing for GPT-6 Astra (USD per million tokens), added to the chat
-- model selector on paid plans. Standard-tier rates from OpenAI's pricing
-- page (gpt-6-astra: $10 in / $50 out). ON CONFLICT keeps any price already
-- set at runtime via the set_pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('gpt-6-astra', 10.0, 50.0)
ON CONFLICT (model) DO NOTHING;
