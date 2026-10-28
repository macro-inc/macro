-- Nano Banana requests IMAGE output only. Standard Gemini API pricing in USD
-- per million tokens: $0.30 for text/image input and $30.00 for image output.
-- https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-image
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out)
VALUES ('gemini-2.5-flash-image', 0.30, 30.00)
ON CONFLICT (model) DO NOTHING;
