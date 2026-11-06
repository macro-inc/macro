SET lock_timeout = '5s';

-- Remove bootstrap values in place. No recovery copy is retained.
UPDATE hosted_runtime
SET persona = jsonb_set(
    jsonb_set(
        persona,
        '{config}',
        COALESCE((
            SELECT jsonb_object_agg(key, value)
            FROM jsonb_each(COALESCE(persona->'config', '{}'::jsonb))
            WHERE key !~* '_(TOKEN|KEY|SECRET)$'
        ), '{}'::jsonb)
    ),
    '{extra_service,env}',
    COALESCE((
        SELECT jsonb_object_agg(key, value)
        FROM jsonb_each(COALESCE(persona->'extra_service'->'env', '{}'::jsonb))
        WHERE key !~* '_(TOKEN|KEY|SECRET)$'
    ), '{}'::jsonb)
)
WHERE persona IS NOT NULL;
