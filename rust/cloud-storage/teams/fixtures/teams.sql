INSERT INTO "User" ("id", "email", "name", "stripeCustomerId") VALUES
('macro|user@user.com', 'user@user.com', 'User', 'cus_1234'),
('macro|user2@user.com', 'user2@user.com', 'User2', NULL),
('macro|user3@user.com', 'user3@user.com', 'User3', NULL),
('macro|user4@user.com', 'user4@user.com', 'User4', NULL);

INSERT INTO team(id, name, owner_id, subscription_id, seat_count)
VALUES ('11111111-1111-1111-1111-111111111111', 'team1', 'macro|user@user.com', 'sub_1', 3), -- seat count is 3 for 2 invites and 1 member
       ('22222222-2222-2222-2222-222222222222', 'team2', 'macro|user@user.com', NULL, 1),
       ('33333333-3333-3333-3333-333333333333', 'team3', 'macro|user@user.com', NULL, 1);

INSERT INTO team_invite (id, team_id, email, team_role, invited_by, created_at, last_sent_at)
VALUES ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'invite@macro.com', 'member', 'macro|user@user.com', NOW(), NOW()),
       ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'user3@user.com', 'member', 'macro|user@user.com', NOW(), NOW());

INSERT INTO team_user (team_id, user_id, team_role)
VALUES ('11111111-1111-1111-1111-111111111111', 'macro|user@user.com', 'owner'),
       ('11111111-1111-1111-1111-111111111111', 'macro|user2@user.com', 'member'),
       ('22222222-2222-2222-2222-222222222222', 'macro|user2@user.com', 'member'),
       ('33333333-3333-3333-3333-333333333333', 'macro|user@user.com', 'owner'),
       ('33333333-3333-3333-3333-333333333333', 'macro|user4@user.com', 'member');
