INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'user@user.com', 'user@user.com', 'cus_1234'),
    ('a2222222-2222-2222-2222-222222222222', 'user2@user.com', 'user2@user.com', 'stripe_user2'),
    ('a3333333-3333-3333-3333-333333333333', 'user3@user.com', 'user3@user.com', 'stripe_user3');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234', 'a1111111-1111-1111-1111-111111111111'),
('macro|user2@user.com', 'user2@user.com', 'User2', NULL, 'a2222222-2222-2222-2222-222222222222'),
('macro|user3@user.com', 'user3@user.com', 'User3', NULL, 'a3333333-3333-3333-3333-333333333333');

INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('11111111-1111-1111-1111-111111111111', 'team1', 'macro|user@user.com', 'sub_1', 2);

INSERT INTO team_user (team_id, user_id, team_role)
VALUES ('11111111-1111-1111-1111-111111111111', 'macro|user@user.com', 'owner'),
       ('11111111-1111-1111-1111-111111111111', 'macro|user2@user.com', 'member');

-- Team channels for team1
INSERT INTO comms_channels (id, name, channel_type, team_id, owner_id, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'General', 'team', '11111111-1111-1111-1111-111111111111', 'macro|user@user.com', NOW(), NOW()),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Random', 'team', '11111111-1111-1111-1111-111111111111', 'macro|user@user.com', NOW(), NOW());

-- Owner is participant in both channels
INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user@user.com', 'owner', NOW()),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user@user.com', 'owner', NOW()),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user2@user.com', 'member', NOW()),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user2@user.com', 'member', NOW());
