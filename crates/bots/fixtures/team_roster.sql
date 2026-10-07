INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('91000000-0000-0000-0000-000000000001', 'roster-owner', 'roster-owner@example.com', 'team-roster-owner'),
('91000000-0000-0000-0000-000000000002', 'roster-other', 'roster-other@example.com', 'team-roster-other'),
('91000000-0000-0000-0000-000000000003', 'roster-empty', 'roster-empty@example.com', 'team-roster-empty');
INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|roster-owner@example.com', 'roster-owner@example.com', '91000000-0000-0000-0000-000000000001'),
('macro|roster-other@example.com', 'roster-other@example.com', '91000000-0000-0000-0000-000000000002'),
('macro|roster-empty@example.com', 'roster-empty@example.com', '91000000-0000-0000-0000-000000000003');
INSERT INTO team (id, name, owner_id) VALUES
('91000000-0000-0000-0000-000000000011', 'Roster team', 'macro|roster-owner@example.com'),
('91000000-0000-0000-0000-000000000012', 'Other team', 'macro|roster-other@example.com'),
('91000000-0000-0000-0000-000000000013', 'Team without bots', 'macro|roster-empty@example.com');
INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle, created_by) VALUES
('91000000-0000-0000-0000-000000000022', 'owned', NULL, '91000000-0000-0000-0000-000000000011', 'Retired team bot', 'roster-retired', 'macro|roster-owner@example.com'),
('91000000-0000-0000-0000-000000000021', 'owned', NULL, '91000000-0000-0000-0000-000000000011', 'Live team bot', 'roster-live', 'macro|roster-owner@example.com'),
('91000000-0000-0000-0000-000000000023', 'owned', NULL, '91000000-0000-0000-0000-000000000012', 'Other team bot', 'roster-other', 'macro|roster-other@example.com'),
('91000000-0000-0000-0000-000000000024', 'owned', 'macro|roster-owner@example.com', NULL, 'User bot', 'roster-user', 'macro|roster-owner@example.com');
