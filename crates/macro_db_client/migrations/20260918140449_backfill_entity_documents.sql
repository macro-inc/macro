INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT
    id::uuid,
    'document',
    'user',
    lower(owner),
    "createdAt" AT TIME ZONE 'UTC',
    "updatedAt" AT TIME ZONE 'UTC',
    "deletedAt" AT TIME ZONE 'UTC'
FROM "Document"
WHERE id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND owner LIKE 'macro|%'
ON CONFLICT (id) DO NOTHING;
