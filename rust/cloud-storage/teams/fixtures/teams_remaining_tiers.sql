-- Fixture for testing get_user_remaining_tiers
-- Sets up users in multiple teams with different tiers

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'owner@test.com', 'owner@test.com', 'cus_owner'),
    ('a2222222-2222-2222-2222-222222222222', 'multi@test.com', 'multi@test.com', 'cus_multi'),
    ('a3333333-3333-3333-3333-333333333333', 'single@test.com', 'single@test.com', 'cus_single'),
    ('a4444444-4444-4444-4444-444444444444', 'notinteam@test.com', 'notinteam@test.com', 'cus_none');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|owner@test.com', 'owner@test.com', 'Owner', 'cus_owner', 'a1111111-1111-1111-1111-111111111111'),
('macro|multi@test.com', 'multi@test.com', 'Multi', 'cus_multi', 'a2222222-2222-2222-2222-222222222222'),
('macro|single@test.com', 'single@test.com', 'Single', 'cus_single', 'a3333333-3333-3333-3333-333333333333'),
('macro|notinteam@test.com', 'notinteam@test.com', 'NoTeam', 'cus_none', 'a4444444-4444-4444-4444-444444444444');

-- Team A: haiku tier members
INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('aaaa1111-1111-1111-1111-111111111111', 'Team A', 'macro|owner@test.com', 'sub_a', 3);

-- Team B: sonnet tier members
INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('bbbb2222-2222-2222-2222-222222222222', 'Team B', 'macro|owner@test.com', 'sub_b', 2);

-- Team C: opus tier members
INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('cccc3333-3333-3333-3333-333333333333', 'Team C', 'macro|owner@test.com', 'sub_c', 2);

INSERT INTO team_user (team_id, user_id, team_role, tier)
VALUES
    -- Owner on all teams
    ('aaaa1111-1111-1111-1111-111111111111', 'macro|owner@test.com', 'owner', 'haiku'),
    ('bbbb2222-2222-2222-2222-222222222222', 'macro|owner@test.com', 'owner', 'sonnet'),
    ('cccc3333-3333-3333-3333-333333333333', 'macro|owner@test.com', 'owner', 'opus'),
    -- multi@test.com: member of all 3 teams with different tiers
    ('aaaa1111-1111-1111-1111-111111111111', 'macro|multi@test.com', 'member', 'haiku'),
    ('bbbb2222-2222-2222-2222-222222222222', 'macro|multi@test.com', 'member', 'sonnet'),
    ('cccc3333-3333-3333-3333-333333333333', 'macro|multi@test.com', 'member', 'opus'),
    -- single@test.com: member of only Team A
    ('aaaa1111-1111-1111-1111-111111111111', 'macro|single@test.com', 'member', 'haiku');
