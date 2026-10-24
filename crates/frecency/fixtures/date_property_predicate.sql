WITH entity_properties(entity_id, entity_type, property_definition_id, values) AS (
    VALUES
        ('dated'::text, 'THREAD'::text, '00000001-0000-0000-0000-000000000004'::uuid,
         '{"type":"Date","value":"2026-10-20T12:00:00Z"}'::jsonb),
        ('boundary', 'THREAD', '00000001-0000-0000-0000-000000000004'::uuid,
         '{"type":"Date","value":"2026-10-21T00:00:00Z"}'::jsonb),
        ('cleared', 'THREAD', '00000001-0000-0000-0000-000000000004'::uuid,
         '{"type":"Date","value":null}'::jsonb),
        ('other', 'THREAD', '00000001-0000-0000-0000-000000000004'::uuid,
         '{"type":"String","value":"not a timestamp"}'::jsonb)
)
SELECT fa.entity_id FROM (VALUES ('dated'), ('boundary'), ('cleared'), ('other'), ('missing')) AS fa(entity_id)
WHERE
