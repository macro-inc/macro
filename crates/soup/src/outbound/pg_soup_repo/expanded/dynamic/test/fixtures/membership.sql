INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('a1000000-0000-0000-0000-000000000001', 'viewer', 'viewer@example.com', 'membership-viewer'),
('a1000000-0000-0000-0000-000000000002', 'creator', 'creator@example.com', 'membership-creator');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|viewer@example.com', 'viewer@example.com', 'a1000000-0000-0000-0000-000000000001'),
('macro|creator@example.com', 'creator@example.com', 'a1000000-0000-0000-0000-000000000002');

INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt")
SELECT 'a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'), 'Task ' || n,
    CASE WHEN n IN (1, 3) THEN 'macro|viewer@example.com' ELSE 'macro|creator@example.com' END,
    'md', '2026-01-01', '2026-01-01'::timestamp + n * interval '1 hour'
FROM generate_series(1, 5) n;
INSERT INTO document_sub_type (document_id, sub_type)
SELECT id, 'task' FROM "Document";

INSERT INTO "DocumentInstance" (id, "documentId", sha)
SELECT n, 'a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'), 'fixture-' || n
FROM generate_series(1, 5) n;

INSERT INTO "SharePermission" (id)
SELECT 'membership-share-' || n FROM generate_series(1, 5) n;
INSERT INTO initiative (id, name, owner_user_id, share_permission_id, created_at, updated_at)
SELECT ('a3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Project ' || n,
    CASE WHEN n IN (1, 3) THEN 'macro|viewer@example.com' ELSE 'macro|creator@example.com' END,
    'membership-share-' || n, '2026-01-01', '2026-01-01'::timestamptz + n * interval '1 hour'
FROM generate_series(1, 5) n;

-- The fifth item is assigned to the viewer without an access grant.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id::uuid, 'document', 'macro|viewer@example.com', 'user', 'owner'
FROM "Document" WHERE name != 'Task 5';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id, 'initiative', 'macro|viewer@example.com', 'user', 'owner'
FROM initiative WHERE name != 'Project 5';

-- A converted task can retain its original DOCUMENT property namespace.
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT ('a4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'a2000000-0000-0000-0000-' || lpad(n::text, 12, '0'), CASE WHEN n = 2 THEN 'DOCUMENT'::property_entity_type ELSE 'TASK'::property_entity_type END,
    '00000001-0000-0000-0000-000000000001',
    '{"type":"EntityReference","value":[{"entity_type":"USER","entity_id":"macro|viewer@example.com"}]}'
FROM generate_series(2, 5) n WHERE n != 4;
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT ('a5000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'a3000000-0000-0000-0000-' || lpad(n::text, 12, '0'), 'INITIATIVE',
    '00000001-0000-0000-0000-000000000001',
    '{"type":"EntityReference","value":[{"entity_type":"USER","entity_id":"macro|viewer@example.com"}]}'
FROM generate_series(2, 5) n WHERE n != 4;
