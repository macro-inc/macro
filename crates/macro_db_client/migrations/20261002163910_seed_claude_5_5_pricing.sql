-- Seed pricing for Claude Sonnet 5.5 and Claude Opus 5.5 (USD per million
-- tokens), which replace Sonnet 5, Opus 5, and Fable 5.1 in the chat
-- selector. Haiku 4.5 stays offered and already has a price row. Priced at
-- the rates of the models they replace (Sonnet $2/$10, Opus $5/$25). ON
-- CONFLICT keeps any price already set at runtime via the set_pricing
-- endpoint. The retired rows are left in place so historical ai_usage rows
-- for those ids still resolve a price.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('claude-sonnet-5-5', 2.0, 10.0),
    ('claude-opus-5-5', 5.0, 25.0)
ON CONFLICT (model) DO NOTHING;
