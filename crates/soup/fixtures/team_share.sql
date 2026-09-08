-- The generic expanded/unexpanded Soup paths support documents (including tasks
-- and snippets), chats, and projects. Calls and threads use separate service paths.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('50000000-0000-0000-0000-000000000001', 'owner@soup.test', 'owner@soup.test', 'soup_owner'),
('50000000-0000-0000-0000-000000000002', 'viewer@soup.test', 'viewer@soup.test', 'soup_viewer'),
('50000000-0000-0000-0000-000000000003', 'other@soup.test', 'other@soup.test', 'soup_other');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@soup.test', 'owner@soup.test', '50000000-0000-0000-0000-000000000001'),
('macro|viewer@soup.test', 'viewer@soup.test', '50000000-0000-0000-0000-000000000002'),
('macro|other@soup.test', 'other@soup.test', '50000000-0000-0000-0000-000000000003');
INSERT INTO team (id, name, owner_id, seat_count) VALUES
('10000000-0000-0000-0000-000000000001', 'Matching team', 'macro|owner@soup.test', 2),
('10000000-0000-0000-0000-000000000002', 'Other team', 'macro|other@soup.test', 1);
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('10000000-0000-0000-0000-000000000001', 'macro|owner@soup.test', 'owner'),
('10000000-0000-0000-0000-000000000001', 'macro|viewer@soup.test', 'member'),
('10000000-0000-0000-0000-000000000002', 'macro|other@soup.test', 'owner');
INSERT INTO "Project" (id, name, "userId") VALUES
('20000000-0000-0000-0000-000000000001', 'Project', 'macro|owner@soup.test');
INSERT INTO "Document" (id, name, owner, "fileType") VALUES
('20000000-0000-0000-0000-000000000002', 'Document', 'macro|owner@soup.test', 'md'),
('20000000-0000-0000-0000-000000000004', 'Task', 'macro|owner@soup.test', 'md'),
('20000000-0000-0000-0000-000000000005', 'Snippet', 'macro|owner@soup.test', 'md');
INSERT INTO "DocumentInstance" ("documentId", sha) SELECT id, id FROM "Document";
INSERT INTO document_sub_type (document_id, sub_type) VALUES
('20000000-0000-0000-0000-000000000004', 'task'),
('20000000-0000-0000-0000-000000000005', 'snippet');
INSERT INTO "Chat" (id, name, "userId") VALUES
('20000000-0000-0000-0000-000000000003', 'Chat', 'macro|owner@soup.test');
INSERT INTO "SharePermission" (id, "linkShare") VALUES
('project', NULL), ('document', NULL), ('chat', NULL), ('task', NULL), ('snippet', NULL);
INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000001', 'project');
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000002', 'document'),
('20000000-0000-0000-0000-000000000004', 'task'),
('20000000-0000-0000-0000-000000000005', 'snippet');
INSERT INTO "ChatPermission" ("chatId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000003', 'chat');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id::uuid, 'project', "userId", 'user'::entity_access_source_type, 'owner'::"AccessLevel" FROM "Project"
UNION ALL SELECT id::uuid, 'document', owner, 'user', 'owner' FROM "Document"
UNION ALL SELECT id::uuid, 'chat', "userId", 'user', 'owner' FROM "Chat";
