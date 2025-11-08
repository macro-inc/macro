INSERT INTO "User" (id, email)
VALUES ('macro|test@macro.com', 'test@macro.com'),
       ('macro|test2@macro.com', 'test2@macro.com'),
       ('macro|test3@macro.com', 'test3@macro.com'),
       ('macro|test4@macro.com', 'test4@macro.com');

INSERT INTO team (id, name, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'team1', 'macro|test@macro.com');

INSERT INTO team_invite (id, email, team_id, team_role, invited_by, created_at, last_sent_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'invite1@macro.com', '11111111-1111-1111-1111-111111111111', 'member', 'macro|test@macro.com', NOW(), NOW()),
       ('22222222-2222-2222-2222-222222222222', 'invite2@macro.com', '11111111-1111-1111-1111-111111111111', 'member', 'macro|test@macro.com', NOW(), NOW()),
       ('33333333-3333-3333-3333-333333333333', 'invite3@macro.com', '11111111-1111-1111-1111-111111111111', 'member', 'macro|test@macro.com', NOW(), NOW());

INSERT INTO team_user (user_id, team_id, team_role)
VALUES ('macro|test@macro.com', '11111111-1111-1111-1111-111111111111', 'owner'),
       ('macro|test2@macro.com', '11111111-1111-1111-1111-111111111111', 'member'),
       ('macro|test3@macro.com', '11111111-1111-1111-1111-111111111111', 'member'),
       ('macro|test4@macro.com', '11111111-1111-1111-1111-111111111111', 'admin');
