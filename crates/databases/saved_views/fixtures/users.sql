INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('a1111111-1111-1111-1111-111111111111', 'owner@example.com', 'owner@example.com', 'cus_owner'),
('a2222222-2222-2222-2222-222222222222', 'viewer@example.com', 'viewer@example.com', 'cus_viewer');
INSERT INTO "User" (id, email, name, macro_user_id) VALUES
('macro|owner@example.com', 'owner@example.com', 'Owner', 'a1111111-1111-1111-1111-111111111111'),
('macro|viewer@example.com', 'viewer@example.com', 'Viewer', 'a2222222-2222-2222-2222-222222222222');
INSERT INTO team (id, name, owner_id) VALUES
('11111111-1111-1111-1111-111111111111', 'Team', 'macro|owner@example.com');
INSERT INTO team_user (team_id, user_id, team_role) VALUES
('11111111-1111-1111-1111-111111111111', 'macro|owner@example.com', 'owner'),
('11111111-1111-1111-1111-111111111111', 'macro|viewer@example.com', 'member');
