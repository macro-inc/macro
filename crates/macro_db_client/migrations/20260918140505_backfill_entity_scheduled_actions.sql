INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT id, 'scheduled_action', 'user', lower(owner), created_at, updated_at, NULL
FROM scheduled_action
WHERE owner LIKE 'macro|%'
ON CONFLICT (id) DO NOTHING;
