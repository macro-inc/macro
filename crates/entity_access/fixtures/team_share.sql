-- No implicit public links, channel participation, or history: sharing is the only
-- non-owner access path until a test deliberately adds an independent contribution.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('50000000-0000-0000-0000-000000000001', 'owner@share.test', 'owner@share.test', 'share_owner'),
('50000000-0000-0000-0000-000000000002', 'viewer@share.test', 'viewer@share.test', 'share_viewer'),
('50000000-0000-0000-0000-000000000003', 'other@share.test', 'other@share.test', 'share_other');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|owner@share.test', 'owner@share.test', '50000000-0000-0000-0000-000000000001'),
('macro|viewer@share.test', 'viewer@share.test', '50000000-0000-0000-0000-000000000002'),
('macro|other@share.test', 'other@share.test', '50000000-0000-0000-0000-000000000003');
INSERT INTO team (id, name, owner_id, seat_count) VALUES
('10000000-0000-0000-0000-000000000001', 'Matching team', 'macro|owner@share.test', 2),
('10000000-0000-0000-0000-000000000002', 'Other team', 'macro|other@share.test', 1);
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('10000000-0000-0000-0000-000000000001', 'macro|owner@share.test', 'owner'),
('10000000-0000-0000-0000-000000000001', 'macro|viewer@share.test', 'member'),
('10000000-0000-0000-0000-000000000002', 'macro|other@share.test', 'owner');
INSERT INTO "Project" (id, name, "userId") VALUES
('20000000-0000-0000-0000-000000000001', 'Project', 'macro|owner@share.test'),
('20000000-0000-0000-0000-000000000009', 'Ancestor', 'macro|owner@share.test');
INSERT INTO "Document" (id, name, owner, "fileType") VALUES
('20000000-0000-0000-0000-000000000002', 'Document', 'macro|owner@share.test', 'md'),
('20000000-0000-0000-0000-000000000007', 'Task', 'macro|owner@share.test', 'md'),
('20000000-0000-0000-0000-000000000008', 'Snippet', 'macro|owner@share.test', 'md');
INSERT INTO document_sub_type (document_id, sub_type) VALUES
('20000000-0000-0000-0000-000000000007', 'task'),
('20000000-0000-0000-0000-000000000008', 'snippet');
INSERT INTO "Chat" (id, name, "userId") VALUES
('20000000-0000-0000-0000-000000000003', 'Chat', 'macro|owner@share.test');
INSERT INTO "SharePermission" (id, "linkShare") VALUES
('project', NULL), ('document', NULL), ('chat', NULL), ('thread', NULL),
('active-call', NULL), ('archived-call', NULL), ('task', NULL), ('snippet', NULL), ('ancestor', NULL);
INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000001', 'project'),
('20000000-0000-0000-0000-000000000009', 'ancestor');
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000002', 'document'),
('20000000-0000-0000-0000-000000000007', 'task'),
('20000000-0000-0000-0000-000000000008', 'snippet');
INSERT INTO "ChatPermission" ("chatId", "sharePermissionId") VALUES
('20000000-0000-0000-0000-000000000003', 'chat');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('30000000-0000-0000-0000-000000000001', 'macro|owner@share.test', 'fusionauth', 'owner@share.test', 'GMAIL');
INSERT INTO email_threads (id, link_id) VALUES
('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001');
INSERT INTO "EmailThreadPermission" ("threadId", "sharePermissionId", "userId") VALUES
('20000000-0000-0000-0000-000000000004', 'thread', 'macro|owner@share.test');
INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
('40000000-0000-0000-0000-000000000001', 'Calls', 'private', 'macro|other@share.test');
INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id) VALUES
('20000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', 'active', 'macro|owner@share.test', 'active-call');
INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, duration_ms, share_permission_id) VALUES
('20000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', 'archived', 'macro|owner@share.test', now(), 0, 'archived-call');
INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id::uuid, 'project', "userId", 'user'::entity_access_source_type, 'owner'::"AccessLevel" FROM "Project"
UNION ALL SELECT id::uuid, 'document', owner, 'user', 'owner' FROM "Document"
UNION ALL SELECT id::uuid, 'chat', "userId", 'user', 'owner' FROM "Chat"
UNION ALL SELECT id, 'call', created_by, 'user', 'owner' FROM calls
UNION ALL SELECT id, 'call', created_by, 'user', 'owner' FROM call_records;
