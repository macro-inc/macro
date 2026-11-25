DELETE FROM ai_pricing
WHERE model IN (
    'capsolver-recaptcha-v2',
    'capsolver-recaptcha-v2-enterprise',
    'capsolver-recaptcha-v3',
    'capsolver-recaptcha-v3-enterprise',
    'capsolver-turnstile'
);
