INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('50000000-0000-0000-0000-000000000001', 'owner@example.com', 'owner@example.com', 'cus_owner'),
    ('50000000-0000-0000-0000-000000000002', 'other@example.com', 'other@example.com', 'cus_other');
INSERT INTO "User" (id, email, name, macro_user_id) VALUES
    ('macro|owner@example.com', 'owner@example.com', 'Owner', '50000000-0000-0000-0000-000000000001'),
    ('macro|other@example.com', 'other@example.com', 'Other', '50000000-0000-0000-0000-000000000002');
INSERT INTO team (id, name, owner_id, seat_count) VALUES
    ('10000000-0000-0000-0000-000000000001', 'Team', 'macro|owner@example.com', 2);
INSERT INTO team_user (team_id, user_id, team_role) VALUES
    ('10000000-0000-0000-0000-000000000001', 'macro|owner@example.com', 'owner');
INSERT INTO "Project" (id, name, "userId") VALUES
    ('20000000-0000-0000-0000-000000000001', 'Root', 'macro|owner@example.com');
INSERT INTO "Document" (id, name, owner) VALUES
    ('20000000-0000-0000-0000-000000000002', 'Document', 'macro|owner@example.com');
INSERT INTO "Chat" (id, name, "userId") VALUES
    ('20000000-0000-0000-0000-000000000003', 'Chat', 'macro|owner@example.com');
INSERT INTO "SharePermission" (id) VALUES ('project'), ('document'), ('chat'), ('active-call'), ('archived-call');
INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES ('20000000-0000-0000-0000-000000000001', 'project');
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES ('20000000-0000-0000-0000-000000000002', 'document');
INSERT INTO "ChatPermission" ("chatId", "sharePermissionId") VALUES ('20000000-0000-0000-0000-000000000003', 'chat');
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
    ('30000000-0000-0000-0000-000000000001', 'macro|owner@example.com', 'fusionauth', 'alias@example.com', 'GMAIL');
INSERT INTO email_threads (id, link_id) VALUES
    ('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001');
INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
    ('40000000-0000-0000-0000-000000000001', 'Calls', 'private', 'macro|other@example.com');
INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id) VALUES
    ('20000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', 'active', 'macro|owner@example.com', 'active-call');
INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, duration_ms, share_permission_id) VALUES
    ('20000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', 'archived', 'macro|owner@example.com', now(), 0, 'archived-call');
