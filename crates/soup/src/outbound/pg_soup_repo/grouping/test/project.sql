-- All three tasks have legacy folder IDs that must not determine their groups.
INSERT INTO document_sub_type (document_id, sub_type) VALUES
('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task'),
('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'task'),
('11111111-cccc-cccc-cccc-cccccccccccc', 'task');

INSERT INTO "SharePermission" (id) VALUES ('group-project-one'), ('group-project-two');
INSERT INTO initiative (id, name, owner_user_id, share_permission_id)
SELECT projects.id::uuid, projects.name, document.owner, projects.share_permission_id
FROM (VALUES
    ('ad000000-0000-0000-0000-000000000001', 'Project One', 'group-project-one'),
    ('ad000000-0000-0000-0000-000000000002', 'Project Two', 'group-project-two')
) AS projects(id, name, share_permission_id)
CROSS JOIN "Document" document
WHERE document.id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES
('e0000000-0000-0000-0000-000000000101', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TASK',
 '00000001-0000-0000-0000-000000000014',
 '{"type":"EntityReference","value":[{"entity_type":"INITIATIVE","entity_id":"ad000000-0000-0000-0000-000000000001"}]}'),
('e0000000-0000-0000-0000-000000000102', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TASK',
 '00000001-0000-0000-0000-000000000014',
 '{"type":"EntityReference","value":[{"entity_type":"INITIATIVE","entity_id":"ad000000-0000-0000-0000-000000000002"}]}'),
-- A stale DOCUMENT assignment for a task must not create another group.
('e0000000-0000-0000-0000-000000000103', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DOCUMENT',
 '00000001-0000-0000-0000-000000000014',
 '{"type":"EntityReference","value":[{"entity_type":"INITIATIVE","entity_id":"ad000000-0000-0000-0000-000000000002"}]}');
