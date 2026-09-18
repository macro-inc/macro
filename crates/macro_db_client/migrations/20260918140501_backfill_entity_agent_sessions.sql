INSERT INTO entity (id, entity_type, owner_type, owner_id, created_at, updated_at, deleted_at)
SELECT id, 'agent_session', 'user', lower(owner_id), created_at, modified_at, NULL
FROM agent_session
WHERE owner_id LIKE 'macro|%'
ON CONFLICT (id) DO NOTHING;
