-- The isolated document is granted only to a team the test user (the fixture
-- documents' owner) belongs to.
INSERT INTO team (id, name, owner_id) VALUES
('ac000000-0000-0000-0000-000000000003', 'member', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('ac000000-0000-0000-0000-000000000003', (SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'member');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
('11111111-9999-9999-9999-999999999999', 'document', 'ac000000-0000-0000-0000-000000000003', 'team', 'view', NULL);
