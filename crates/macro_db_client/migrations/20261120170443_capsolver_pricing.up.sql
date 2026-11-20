-- CapSolver token-task prices, USD per solved task (one provider credit):
-- https://docs.capsolver.com/en/pricing/ — reCAPTCHA v2 $0.80/k,
-- v2 Enterprise $1.00/k, v3 $1.00/k, v3 Enterprise $3.00/k, Turnstile $1.20/k.
-- CapSolver charges only solved tasks, and the gateway bills only those.
-- Preserve any rate already configured by an administrator.
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out, price_per_provider_credit)
VALUES
    ('capsolver-recaptcha-v2', 0, 0, 0.0008),
    ('capsolver-recaptcha-v2-enterprise', 0, 0, 0.001),
    ('capsolver-recaptcha-v3', 0, 0, 0.001),
    ('capsolver-recaptcha-v3-enterprise', 0, 0, 0.003),
    ('capsolver-turnstile', 0, 0, 0.0012)
ON CONFLICT (model) DO NOTHING;
