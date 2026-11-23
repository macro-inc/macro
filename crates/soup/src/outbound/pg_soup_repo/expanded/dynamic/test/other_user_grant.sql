-- The isolated document is granted to another user, directly and through its
-- project; the test user holds neither grant.
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES
('11111111-9999-9999-9999-999999999999', 'document', 'macro|other-user', 'user', 'owner', NULL),
('11111111-9999-9999-9999-999999999999', 'document', 'macro|other-user', 'user', 'view', '99999999-ffff-ffff-ffff-ffffffffffff');
