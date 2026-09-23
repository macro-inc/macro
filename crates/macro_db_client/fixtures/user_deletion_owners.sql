INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES ('01900000-0000-7000-8000-000000000001', 'cleanup', 'cleanup@example.com', 'cleanup-stripe-id');

-- Non-user principals still need compatibility rows for the legacy owner FKs.
INSERT INTO "User" (id, email, macro_user_id)
VALUES
    ('macro|cleanup@example.com', 'cleanup@example.com', '01900000-0000-7000-8000-000000000001'),
    ('macro|other@example.com', 'other@example.com', '01900000-0000-7000-8000-000000000001'),
    ('bot|01900000-0000-7000-8000-000000000002', 'bot@example.com', '01900000-0000-7000-8000-000000000001'),
    ('01900000-0000-7000-8000-000000000003', 'team@example.com', '01900000-0000-7000-8000-000000000001');

INSERT INTO entity (id, entity_type, owner_type, owner_id)
VALUES
    ('01900000-0000-7000-8000-000000000101', 'document', 'user', 'macro|cleanup@example.com'),
    ('01900000-0000-7000-8000-000000000102', 'chat', 'user', 'macro|cleanup@example.com'),
    ('01900000-0000-7000-8000-000000000103', 'project', 'user', 'macro|cleanup@example.com'),
    ('01900000-0000-7000-8000-000000000201', 'document', 'user', 'macro|other@example.com'),
    ('01900000-0000-7000-8000-000000000202', 'chat', 'user', 'macro|other@example.com'),
    ('01900000-0000-7000-8000-000000000203', 'project', 'user', 'macro|other@example.com'),
    ('01900000-0000-7000-8000-000000000301', 'document', 'bot', 'bot|01900000-0000-7000-8000-000000000002'),
    ('01900000-0000-7000-8000-000000000302', 'chat', 'bot', 'bot|01900000-0000-7000-8000-000000000002'),
    ('01900000-0000-7000-8000-000000000303', 'project', 'bot', 'bot|01900000-0000-7000-8000-000000000002'),
    ('01900000-0000-7000-8000-000000000401', 'document', 'team', '01900000-0000-7000-8000-000000000003'),
    ('01900000-0000-7000-8000-000000000402', 'chat', 'team', '01900000-0000-7000-8000-000000000003'),
    ('01900000-0000-7000-8000-000000000403', 'project', 'team', '01900000-0000-7000-8000-000000000003');

INSERT INTO "Document" (id, name, owner, "deletedAt")
SELECT id::text, 'cleanup document', owner_id,
    CASE WHEN owner_id = 'macro|cleanup@example.com' THEN now() END
FROM entity WHERE entity_type = 'document';

INSERT INTO "Chat" (id, name, "userId")
SELECT id::text, 'cleanup chat', owner_id FROM entity WHERE entity_type = 'chat';

INSERT INTO "Project" (id, name, "userId")
SELECT id::text, 'cleanup project', owner_id FROM entity WHERE entity_type = 'project';

-- Include a UUID document whose registry record has not been backfilled yet.
INSERT INTO "Document" (id, name, owner)
VALUES ('01900000-0000-7000-8000-000000000104', 'unregistered', 'macro|cleanup@example.com');

-- All resources are shared with the deleted user AND another user. Cleanup must
-- remove every grant on owned resources, but not grants on non-owned resources.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT e.id, e.entity_type, u.id, 'user', 'view'
FROM entity e
CROSS JOIN "User" u
WHERE u.id IN ('macro|cleanup@example.com', 'macro|other@example.com');

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES ('01900000-0000-7000-8000-000000000104', 'document', 'macro|other@example.com', 'user', 'view');

-- The unrelated document survives, but this inherited grant must not.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
VALUES ('01900000-0000-7000-8000-000000000201', 'document', 'macro|other@example.com', 'user', 'view', '01900000-0000-7000-8000-000000000103');
