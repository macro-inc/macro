-- Unreleased computer state requires explicit, durable payment provenance.
UPDATE hosted_runtime
SET state = jsonb_set(
    state,
    '{payment}',
    to_jsonb(CASE state->'phase'->>'phase'
        WHEN 'pending_payment' THEN 'pending'::text
        WHEN 'payment_failed' THEN 'unbilled'::text
        ELSE 'paid'::text
    END)
)
WHERE NOT state ? 'payment';
