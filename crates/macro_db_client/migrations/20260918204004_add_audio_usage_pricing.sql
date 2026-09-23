-- Add duration billing alongside token billing; deployed token-only writers can
-- continue omitting every new column.
ALTER TABLE ai_pricing
    ADD COLUMN price_per_audio_minute REAL
        CHECK (price_per_audio_minute >= 0 AND price_per_audio_minute < 'Infinity'::real);

ALTER TABLE ai_usage
    ADD COLUMN audio_seconds DOUBLE PRECISION
        CHECK (audio_seconds >= 0 AND audio_seconds < 'Infinity'::double precision),
    ADD COLUMN price_per_audio_minute REAL
        CHECK (price_per_audio_minute >= 0 AND price_per_audio_minute < 'Infinity'::real);

-- https://platform.openai.com/docs/pricing — Whisper is priced per audio minute.
-- Preserve any rate already configured by an administrator.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_audio_minute)
VALUES ('whisper-1', 0, 0, 0.006)
ON CONFLICT (model) DO NOTHING;
