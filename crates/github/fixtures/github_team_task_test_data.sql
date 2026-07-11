INSERT INTO
    public.macro_user (id, username, email, stripe_customer_id)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'testuser', 'testuser@test.com', 'cus_test'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'owner2', 'owner2@test.com', 'cus_test2');

INSERT INTO
    public."User" (id, email, macro_user_id)
VALUES
    ('macro|user@user.com', 'testuser@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
    ('macro|owner2@user.com', 'owner2@test.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

INSERT INTO
    public.team (id, name, owner_id, slug)
VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'Engineering', 'macro|user@user.com', 'ENG'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Platform API', 'macro|owner2@user.com', 'PLATFORM_API');

INSERT INTO
    public.team_user (user_id, team_id, team_role)
VALUES
    ('macro|user@user.com', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'owner'),
    ('macro|owner2@user.com', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'owner');

INSERT INTO
    public."Document" (id, name, "fileType", owner)
VALUES
    ('0d0dc589-f301-43f1-8b11-4ab448ca4bb4', 'Known Task', 'md', 'macro|user@user.com'),
    ('11111111-1111-1111-1111-111111111111', 'Platform Task', 'md', 'macro|user@user.com');

INSERT INTO
    public.document_sub_type (document_id, sub_type)
VALUES
    ('0d0dc589-f301-43f1-8b11-4ab448ca4bb4', 'task'),
    ('11111111-1111-1111-1111-111111111111', 'task');

INSERT INTO
    public.team_task (team_id, document_id, task_num)
VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, '0d0dc589-f301-43f1-8b11-4ab448ca4bb4', 123),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, '11111111-1111-1111-1111-111111111111', 7);

INSERT INTO
    public.github_app_installation (id, source_id, source_type)
VALUES
    ('12345', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'team'::github_app_installation_source_type),
    ('12345', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'team'::github_app_installation_source_type);
