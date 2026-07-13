-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."SharePermission", public."ProjectPermission", public.entity_access RESTART IDENTITY CASCADE;

-- Create users with different permission profiles.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2', 'user2@test.com', 'stripe_user2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3', 'user3@test.com', 'stripe_user3');
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'), -- Has deep explicit access grants.
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222'), -- Has a single, lower-level explicit grant.
       ('user-public-access-only', 'user3@test.com', 'a3333333-3333-3333-3333-333333333333');
-- Has no explicit grants, relies on public access.

-- Create a nested project hierarchy: p-grandparent -> p-parent -> p-child.
-- Also create an isolated project with no permissions for "none" test case.
-- Using UUIDs for project IDs since entity_access.entity_id is UUID type.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'Grandparent Project', 'user-1', NULL),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'Parent Project', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003', 'Child Project', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000004', 'Isolated Project', 'user-1', NULL);

-- Add SharePermission records for public access.
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
VALUES
    -- A public 'edit' permission. We'll attach this to the grandparent project.
    ('sp-public-edit-proj', true, 'edit'),
    -- A public 'view' permission. We'll attach this to the parent project.
    ('sp-public-view-proj', true, 'view'),
    -- A *private* 'owner' permission. This MUST be ignored by the query.
    ('sp-private-owner-proj', false, 'owner');

-- Link share permissions to projects.
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'sp-public-edit-proj'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'sp-public-view-proj'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000003', 'sp-public-edit-proj');
-- Attach private permission to child to test filter.


-- Add explicit entity_access records (replacing UserItemAccess).
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
-- user-1 has an explicit 'owner' grant on the grandparent project. This is their highest possible access.
('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'project', 'user-1', 'user', 'owner');
