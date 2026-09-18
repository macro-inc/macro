-- Historical backfill for scheduled_action rows created before dual-write.
-- Skip owners that fail entity_owner_id_matches_type. ON CONFLICT leaves
-- already-registered rows untouched.
INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT
    src.id,
    'scheduled_action',
    'user',
    lower(src.owner),
    src.created_at,
    src.updated_at,
    NULL
FROM (
    SELECT id, owner, created_at, updated_at
    FROM scheduled_action
    WHERE owner LIKE 'macro|%'
) src
ON CONFLICT (id) DO NOTHING;
