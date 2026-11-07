INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('90000000-0000-0000-0000-000000000001', 'sponsor', 'sponsor@example.com', 'owner-grants-sponsor'),
('90000000-0000-0000-0000-000000000002', 'creator', 'creator@example.com', 'owner-grants-creator');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|sponsor@example.com', 'sponsor@example.com', '90000000-0000-0000-0000-000000000001'),
('macro|creator@example.com', 'creator@example.com', '90000000-0000-0000-0000-000000000002');
INSERT INTO team (id, name, owner_id) VALUES
('90000000-0000-0000-0000-000000000011', 'Sponsor team', 'macro|sponsor@example.com');
INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle, created_by) VALUES
('90000000-0000-0000-0000-000000000021', 'owned', NULL, '90000000-0000-0000-0000-000000000011', 'Team bot', 'sponsor-team-bot', 'macro|creator@example.com'),
('90000000-0000-0000-0000-000000000022', 'owned', 'macro|sponsor@example.com', NULL, 'User bot', 'sponsor-user-bot', 'macro|creator@example.com');
