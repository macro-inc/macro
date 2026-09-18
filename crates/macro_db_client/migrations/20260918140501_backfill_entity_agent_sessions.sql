-- Historical backfill for agent_session rows created before dual-write.
-- Skip owners that fail entity_owner_id_matches_type. ON CONFLICT leaves
-- already-registered rows untouched.
INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT
    src.id,
    'agent_session',
    'user',
    lower(src.owner_id),
    src.created_at,
    src.modified_at,
    NULL
FROM (
    SELECT id, owner_id, created_at, modified_at
    FROM agent_session
    WHERE owner_id LIKE 'macro|%'
) src
ON CONFLICT (id) DO NOTHING;
