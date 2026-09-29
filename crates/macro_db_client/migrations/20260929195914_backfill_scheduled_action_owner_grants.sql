-- Existing routines predate entity_access grants. Every routine written so far is
-- user-owned (the owner column carried a FK to "User" until 20260923183235), so a
-- non-user owner here is data this migration must not guess about.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM scheduled_action WHERE owner NOT LIKE 'macro|%') THEN
        RAISE EXCEPTION 'scheduled_action has a non-user owner; backfill its grants by hand';
    END IF;
END
$$;

INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at)
SELECT id, 'scheduled_action', 'user', owner, created_at, updated_at
FROM scheduled_action
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id, 'scheduled_action', owner, 'user', 'owner'
FROM scheduled_action
ON CONFLICT (entity_id, entity_type, source_id, source_type)
WHERE granted_from_project_id IS NULL
DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
WHERE entity_access.access_level <> 'owner';
