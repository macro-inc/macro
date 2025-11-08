-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."SharePermission", public."ProjectPermission", public."UserItemAccess" RESTART IDENTITY CASCADE;

-- Create users with different permission profiles.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'), -- Has deep explicit access grants.
       ('user-2', 'user2@test.com'), -- Has a single, lower-level explicit grant.
       ('user-public-access-only', 'user3@test.com');
-- Has no explicit grants, relies on public access.

-- Create a nested project hierarchy: p-grandparent -> p-parent -> p-child.
-- Also create an isolated project with no permissions for "none" test case.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent'),
       ('p-child', 'Child Project', 'user-1', 'p-parent'),
       ('p-isolated', 'Isolated Project', 'user-1', NULL);

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
VALUES ('p-grandparent', 'sp-public-edit-proj'),
       ('p-parent', 'sp-public-view-proj'),
       ('p-child', 'sp-private-owner-proj');
-- Attach private permission to child to test filter.


-- Add explicit UserItemAccess records.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- user-1 has an explicit 'owner' grant on the grandparent project. This is their highest possible access.
('10000000-0000-0000-0000-000000000001', 'user-1', 'p-grandparent', 'project', 'owner'),
-- user-1 also has a lower-level 'view' grant on the child, which should be overridden by the higher inherited grant.
('10000000-0000-0000-0000-000000000002', 'user-1', 'p-child', 'project', 'view'),
-- user-2 has explicit 'comment' access on the parent project to test user scoping.
('10000000-0000-0000-0000-000000000003', 'user-2', 'p-parent', 'project', 'comment');