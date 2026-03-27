INSERT INTO
    public.macro_user (id, username, email, stripe_customer_id)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'testuser', 'testuser@test.com', 'cus_test'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'testuser2', 'testuser2@test.com', 'cus_test2');

INSERT INTO
    public."User" (id, email, macro_user_id)
VALUES
    ('macro|user@user.com', 'testuser@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
    ('macro|user2@user.com', 'testuser2@test.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

INSERT INTO
    public.github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'macro|user@user.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'testuser', '12345');

INSERT INTO
    public.team (id, name, owner_id)
VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'Team Alpha', 'macro|user@user.com'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Team Beta', 'macro|user2@user.com');

INSERT INTO
    public.team_user (user_id, team_id, team_role)
VALUES
    ('macro|user@user.com', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'owner'),
    ('macro|user2@user.com', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'owner');
