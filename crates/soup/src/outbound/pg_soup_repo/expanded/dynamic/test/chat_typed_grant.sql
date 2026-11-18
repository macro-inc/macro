-- The test user (the fixture documents' owner) holds grants on the isolated
-- document's uuid, but typed as a chat, directly and through a project.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
('11111111-9999-9999-9999-999999999999', 'chat', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'user', 'owner', NULL),
('11111111-9999-9999-9999-999999999999', 'chat', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'user', 'view', '99999999-ffff-ffff-ffff-ffffffffffff');
