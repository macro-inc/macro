-- Historical backfill for Chat rows created before dual-write.
-- Filter in the subquery before id::uuid so a legacy TEXT id cannot abort the
-- statement. Non-UUID ids and non-macro owners cannot be stored in entity.
-- ON CONFLICT leaves already-registered rows untouched.
INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT
    src.id::uuid,
    'chat',
    'user',
    lower(src."userId"),
    src."createdAt" AT TIME ZONE 'UTC',
    src."updatedAt" AT TIME ZONE 'UTC',
    src."deletedAt" AT TIME ZONE 'UTC'
FROM (
    SELECT id, "userId", "createdAt", "updatedAt", "deletedAt"
    FROM "Chat"
    WHERE id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND "userId" LIKE 'macro|%'
) src
ON CONFLICT (id) DO NOTHING;
