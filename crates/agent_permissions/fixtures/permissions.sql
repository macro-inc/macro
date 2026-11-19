INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('91000000-0000-0000-0000-000000000001', 'perm-owner', 'perm-owner@example.com', 'perm-owner'),
('91000000-0000-0000-0000-000000000002', 'perm-other', 'perm-other@example.com', 'perm-other');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|perm-owner@example.com', 'perm-owner@example.com', '91000000-0000-0000-0000-000000000001'),
('macro|perm-other@example.com', 'perm-other@example.com', '91000000-0000-0000-0000-000000000002');
INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle, created_by) VALUES
('91000000-0000-0000-0000-000000000021', 'owned', 'macro|perm-owner@example.com', NULL, 'Permissions agent', 'permissions-agent', 'macro|perm-owner@example.com');
INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES
('91000000-0000-0000-0000-000000000031', 'macro|perm-other@example.com', '91000000-0000-0000-0000-000000000021', 'test', 'macrod', '/workspace');
