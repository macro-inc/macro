-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."Chat", public."SharePermission", public."ChatPermission", public."ProjectPermission", public.entity_access RESTART IDENTITY CASCADE;

-- Create three users.
-- user-1: The primary user we will test against, has many explicit permissions.
-- user-2: Has some overlapping explicit permissions to test user scoping.
-- user-public-access-only: Has no explicit permissions, to test reliance on public access.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_user3'),
       ('a4444444-4444-4444-4444-444444444444', 'user4@test.com', 'user4@test.com', 'stripe_user4');

INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'),
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222'),
       ('user-3', 'user3@test.com', 'a3333333-3333-3333-3333-333333333333'),
       ('user-public-access-only', 'user4@test.com', 'a4444444-4444-4444-4444-444444444444');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
-- Using UUIDs for project IDs since entity_access.entity_id is UUID type.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'Grandparent Project', 'user-1', NULL),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'Parent Project', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001');

-- Create chats.
-- Using UUIDs for chat IDs since entity_access.entity_id is UUID type.
-- d-child: Nested inside the project hierarchy.
-- d-standalone: Has no project.
-- d-private: Has no permissions of any kind attached.
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('cccccccc-cccc-cccc-cccc-000000000001', 'Nested Chat', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002'),
       ('cccccccc-cccc-cccc-cccc-000000000002', 'Standalone Chat', 'user-2', NULL),
       ('cccccccc-cccc-cccc-cccc-000000000003', 'Private Chat', 'user-1', NULL);

-- Add SharePermission records. This is the new data for testing public access.
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
VALUES
    -- A public 'edit' permission. We'll attach this to the grandparent project.
    ('sp-public-edit', true, 'edit'),
    -- A public 'view' permission. We'll attach this to the parent project.
    ('sp-public-view', true, 'view'),
    -- A *private* 'owner' permission. This MUST be ignored by the query.
    ('sp-private-owner', false, 'owner');

-- Link share permissions to projects.
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'sp-public-edit'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'sp-public-view');

-- Link the private share permission to the chat to test the "isPublic" filter.
INSERT INTO public."ChatPermission" ("chatId", "sharePermissionId")
VALUES ('cccccccc-cccc-cccc-cccc-000000000001', 'sp-public-edit');


-- Add explicit entity_access records (replacing UserItemAccess)
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES
-- user-1 has explicit 'view' on d-child, 'edit' on p-parent, and 'owner' on p-grandparent.
-- The highest explicit access for user-1 on d-child is therefore 'owner'.
('cccccccc-cccc-cccc-cccc-000000000001', 'chat', 'user-1', 'user', 'owner', NULL),
('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'project', 'user-1', 'user', 'owner', NULL),
('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'project', 'user-1', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'project', 'user-1', 'user', 'owner', NULL),
('cccccccc-cccc-cccc-cccc-000000000001', 'chat', 'user-1', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002'), -- inside of p2
('cccccccc-cccc-cccc-cccc-000000000001', 'chat', 'user-1', 'user', 'owner', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'), -- p2 is inside of p1

('cccccccc-cccc-cccc-cccc-000000000002', 'chat', 'user-2', 'user', 'owner', NULL), -- owner record
('cccccccc-cccc-cccc-cccc-000000000003', 'chat', 'user-1', 'user', 'owner', NULL); -- owner record
