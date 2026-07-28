-- Seed pricing for GPT-5.6 / GPT-5.6 mini (USD per million tokens), which
-- replace GPT-5.5 / gpt-5-mini in the chat model selector. Same prices as the
-- models they replace per the OpenAI pricing page. ON CONFLICT keeps any
-- price already set at runtime via the set_pricing endpoint. The old
-- gpt-5.5 / gpt-5-mini rows are left in place so historical ai_usage rows for
-- those ids still resolve a price.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('gpt-5.6', 5.0, 30.0),
    ('gpt-5.6-mini', 0.75, 4.5)
ON CONFLICT (model) DO NOTHING;
