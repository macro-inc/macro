-- Gemini 4 Hydrogen takes Gemini 3.8 Flash's place at the price users paid for
-- Flash, DeepSeek V4.1 Flash's: $1.50 -> $0.30 in (cache reads $0.075 ->
-- $0.015), $7.50 -> $1.20 out.
INSERT INTO ai_pricing_discount (model, input_discount_percent, output_discount_percent)
SELECT model, 80, 84 FROM ai_pricing WHERE model = 'gemini-4-hydrogen'
ON CONFLICT (model) DO NOTHING;
