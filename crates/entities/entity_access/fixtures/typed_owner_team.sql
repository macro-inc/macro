INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('90000000-0000-0000-0000-000000000001', 'typed-owner', 'typed-owner@example.com', 'typed-owner'),
('90000000-0000-0000-0000-000000000002', 'typed-other', 'typed-other@example.com', 'typed-other'),
('90000000-0000-0000-0000-000000000003', 'typed-teamless', 'typed-teamless@example.com', 'typed-teamless');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|typed-owner@example.com', 'typed-owner@example.com', '90000000-0000-0000-0000-000000000001'),
('macro|typed-other@example.com', 'typed-other@example.com', '90000000-0000-0000-0000-000000000002'),
('macro|typed-teamless@example.com', 'typed-teamless@example.com', '90000000-0000-0000-0000-000000000003');
INSERT INTO team (id, name, owner_id) VALUES
('90000000-0000-0000-0000-000000000011', 'Owner team', 'macro|typed-owner@example.com'),
('90000000-0000-0000-0000-000000000012', 'Other team', 'macro|typed-other@example.com');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('90000000-0000-0000-0000-000000000011', 'macro|typed-owner@example.com', 'owner'),
('90000000-0000-0000-0000-000000000012', 'macro|typed-other@example.com', 'owner');
INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle, created_by) VALUES
('90000000-0000-0000-0000-000000000021', 'owned', NULL, '90000000-0000-0000-0000-000000000011', 'Team bot', 'team-bot', 'macro|typed-other@example.com'),
('90000000-0000-0000-0000-000000000022', 'owned', 'macro|typed-owner@example.com', NULL, 'User bot', 'user-bot', 'macro|typed-other@example.com'),
('90000000-0000-0000-0000-000000000023', 'owned', 'macro|typed-teamless@example.com', NULL, 'Teamless bot', 'teamless-bot', 'macro|typed-owner@example.com');
-- Legacy entity owner columns still reference User. Test-only principal rows let
-- us exercise typed reads without dropping FKs or changing production ownership.
INSERT INTO "User" (id, email, macro_user_id)
SELECT id, email, '90000000-0000-0000-0000-000000000001'::uuid FROM (VALUES
('90000000-0000-0000-0000-000000000011', 'team-principal@example.com'),
('bot|90000000-0000-0000-0000-000000000021', 'team-bot-principal@example.com'),
('bot|90000000-0000-0000-0000-000000000022', 'user-bot-principal@example.com'),
('bot|90000000-0000-0000-0000-000000000023', 'teamless-bot-principal@example.com'),
('bot|90000000-0000-0000-0000-000000000024', 'missing-bot-principal@example.com')) AS principals(id, email);
-- A legacy principal row's membership must not override its typed ownership.
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('90000000-0000-0000-0000-000000000012', '90000000-0000-0000-0000-000000000011', 'member'),
('90000000-0000-0000-0000-000000000012', 'bot|90000000-0000-0000-0000-000000000021', 'member'),
('90000000-0000-0000-0000-000000000012', 'bot|90000000-0000-0000-0000-000000000022', 'member'),
('90000000-0000-0000-0000-000000000012', 'bot|90000000-0000-0000-0000-000000000023', 'member'),
('90000000-0000-0000-0000-000000000012', 'bot|90000000-0000-0000-0000-000000000024', 'member');
INSERT INTO "Document" (id, name, owner) VALUES
('90000000-0000-0000-0000-000000000031', 'User', 'macro|typed-owner@example.com'),
('90000000-0000-0000-0000-000000000032', 'Teamless user', 'macro|typed-teamless@example.com'),
('90000000-0000-0000-0000-000000000033', 'Team', '90000000-0000-0000-0000-000000000011'),
('90000000-0000-0000-0000-000000000034', 'Team bot', 'bot|90000000-0000-0000-0000-000000000021'),
('90000000-0000-0000-0000-000000000035', 'User bot', 'bot|90000000-0000-0000-0000-000000000022'),
('90000000-0000-0000-0000-000000000036', 'Teamless bot', 'bot|90000000-0000-0000-0000-000000000023'),
('90000000-0000-0000-0000-000000000037', 'Missing bot', 'bot|90000000-0000-0000-0000-000000000024');
INSERT INTO "Project" (id, name, "userId") SELECT id, name, owner FROM "Document";
INSERT INTO "Chat" (id, name, "userId") SELECT id, name, owner FROM "Document";
INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
SELECT id, 'TEAM', 'comment' FROM "Document";
INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") SELECT id, id FROM "Document";
INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") SELECT id, id FROM "Project";
INSERT INTO "ChatPermission" ("chatId", "sharePermissionId") SELECT id, id FROM "Chat";
