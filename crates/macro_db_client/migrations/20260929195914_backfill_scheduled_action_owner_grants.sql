-- Existing routines predate entity_access grants. Their entity rows were
-- registered out of band, so only the owner grant is written here. Every routine
-- written so far is user-owned (the owner column carried a FK to "User" until
-- 20260923183235), so a non-user owner here is data this migration must not
-- guess about. User source ids are lowercase, so a mixed-case owner would never
-- match its own grant.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM scheduled_action
        WHERE owner NOT LIKE 'macro|%' OR owner <> lower(owner)
    ) THEN
        RAISE EXCEPTION 'scheduled_action has a non-user owner; backfill its grants by hand';
    END IF;
    IF EXISTS (
        SELECT 1 FROM scheduled_action sa
        JOIN entity e ON e.id = sa.id
        WHERE e.entity_type <> 'scheduled_action'
           OR e.owner_type <> 'user'
           OR e.owner_id <> sa.owner
    ) THEN
        RAISE EXCEPTION 'scheduled_action conflicts with an existing entity registration';
    END IF;
END
$$;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id, 'scheduled_action', owner, 'user', 'owner'
FROM scheduled_action
ON CONFLICT (entity_id, entity_type, source_id, source_type)
WHERE granted_from_project_id IS NULL
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
WHERE entity_access.access_level <> 'owner';
