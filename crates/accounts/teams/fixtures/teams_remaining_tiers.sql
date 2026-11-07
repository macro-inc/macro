-- Fixture for testing get_user_remaining_tiers
-- With unique user_id constraint, each user can only be in one team

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'owner@test.com', 'owner@test.com', 'cus_owner'),
    ('a2222222-2222-2222-2222-222222222222', 'single@test.com', 'single@test.com', 'cus_single'),
    ('a3333333-3333-3333-3333-333333333333', 'notinteam@test.com', 'notinteam@test.com', 'cus_none');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|owner@test.com', 'owner@test.com', 'Owner', 'cus_owner', 'a1111111-1111-1111-1111-111111111111'),
('macro|single@test.com', 'single@test.com', 'Single', 'cus_single', 'a2222222-2222-2222-2222-222222222222'),
('macro|notinteam@test.com', 'notinteam@test.com', 'NoTeam', 'cus_none', 'a3333333-3333-3333-3333-333333333333');

INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('aaaa1111-1111-1111-1111-111111111111', 'Team A', 'macro|owner@test.com', 'sub_a', 2),
       ('bbbb2222-2222-2222-2222-222222222222', 'Team B', 'macro|single@test.com', 'sub_b', 1);

INSERT INTO team_user (team_id, user_id, team_role)
VALUES
    ('aaaa1111-1111-1111-1111-111111111111', 'macro|owner@test.com', 'owner'),
    ('bbbb2222-2222-2222-2222-222222222222', 'macro|single@test.com', 'owner');
