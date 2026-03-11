INSERT INTO
    public.macro_user (id, username, email, stripe_customer_id)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'testuser', 'testuser@test.com', 'cus_test');

INSERT INTO
    public."User" (id, email, macro_user_id)
VALUES
    ('macro|user@user.com', 'testuser@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

INSERT INTO
    public.github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id) (
        SELECT
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
            'macro|user@user.com',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
            'testuser',
            '12345'
    );

INSERT INTO
    public.in_progress_user_link (id, macro_user_id) (
        SELECT
            'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
    );
