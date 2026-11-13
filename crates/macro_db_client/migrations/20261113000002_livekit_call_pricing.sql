-- LiveKit Inference Build/Ship rates: https://livekit.com/pricing/inference
-- Nova-3 monolingual: $0.0048/min; Aura-2: $30/million input characters.
-- Preserve administrator-configured negotiated or discounted project rates.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_audio_minute)
VALUES ('livekit-inference-deepgram-nova-3', 0, 0, 0.0048)
ON CONFLICT (model) DO NOTHING;

INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_provider_credit)
VALUES ('livekit-inference-deepgram-aura-2', 0, 0, 0.000030)
ON CONFLICT (model) DO NOTHING;
