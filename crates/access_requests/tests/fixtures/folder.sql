INSERT INTO "Project" (id, name, "userId") VALUES
('00000000-0000-0000-0000-000000000020', 'Shared folder', 'macro|owner@requests.test');
UPDATE "Document" SET "projectId" = '00000000-0000-0000-0000-000000000020' WHERE id = '00000000-0000-0000-0000-000000000010';
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
('00000000-0000-0000-0000-000000000020', 'project', 'macro|owner@requests.test', 'user', 'owner'),
('00000000-0000-0000-0000-000000000020', 'project', 'macro|reader@requests.test', 'user', 'view');
