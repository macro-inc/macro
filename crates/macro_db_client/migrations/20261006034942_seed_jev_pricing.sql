-- Seed pricing for TypeSafe's Jev yes/no classifier (USD per million tokens),
-- which gates event-triggered routines on a user-written condition. TypeSafe
-- charges $0.042 per million input tokens and nothing for output. Usage is
-- recorded under the requested model id, `jev-latest`. ON CONFLICT keeps any
-- price already set at runtime via the set_pricing endpoint.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('jev-latest', 0.042, 0)
ON CONFLICT (model) DO NOTHING;
