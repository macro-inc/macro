-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."SharePermission", public."EmailThreadPermission", public."ProjectPermission", public.entity_access RESTART IDENTITY CASCADE;

-- Create macro_user entries (must exist before User rows).
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_user3');

-- Create users with different permission profiles.
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'), -- Has deep explicit access grants.
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222'), -- Has a single, lower-level explicit grant.
       ('user-public-access-only', 'user3@test.com', 'a3333333-3333-3333-3333-333333333333');
-- Has no explicit grants, relies on public access.

-- Create a nested project hierarchy: p-grandparent -> p-parent.
-- Using UUIDs for project IDs since entity_access.entity_id is UUID type.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'Grandparent Project', 'user-1', NULL),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'Parent Project', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001');

-- Create placeholder SharePermission records. These are needed for the FK constraint in EmailThreadPermission.
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
VALUES
    -- For the nested thread
    ('sp-thread-nested', false, NULL), -- this permission itself isn't used, just the link
    -- For the standalone thread
    ('sp-thread-standalone', false, NULL),
    -- For the private thread
    ('sp-thread-private', false, NULL),
    -- Public permissions that will be linked to projects
    ('sp-public-edit-thread', true, 'edit'),
    ('sp-public-view-thread', true, 'view'),
    -- A *private* 'owner' permission to test the `isPublic` filter.
    ('sp-private-owner-thread', false, 'owner');


-- Link the private 'owner' permission directly to the nested thread.
UPDATE public."SharePermission"
SET "isPublic"          = false,
    "publicAccessLevel" = 'owner'
WHERE "id" = 'sp-thread-nested';

-- Link public permissions to the project hierarchy.
INSERT INTO public."ProjectPermission" ("projectId", "sharePermissionId")
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'sp-public-edit-thread'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'sp-public-view-thread');


-- Link threads to projects (or not) via EmailThreadPermission.
-- Using UUIDs for thread IDs since entity_access.entity_id is UUID type.
INSERT INTO public."EmailThreadPermission" ("threadId", "sharePermissionId", "userId", "projectId")
VALUES ('eeeeeeee-eeee-eeee-eeee-000000000001', 'sp-thread-nested', 'user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000002'),   -- Main test subject, in a project
       ('eeeeeeee-eeee-eeee-eeee-000000000002', 'sp-thread-standalone', 'user-1', NULL), -- No project link
       ('eeeeeeee-eeee-eeee-eeee-000000000003', 'sp-thread-private', 'user-1', NULL);
-- No project link, no permissions


-- Add explicit entity_access records (replacing UserItemAccess).
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
-- user-1 has explicit 'view' on thread-nested, and inherited 'owner' from p-grandparent.
('eeeeeeee-eeee-eeee-eeee-000000000001', 'thread', 'user-1', 'user', 'view'),
('aaaaaaaa-aaaa-aaaa-aaaa-000000000001', 'project', 'user-1', 'user', 'owner'),
-- user-1 also has direct 'comment' access on the standalone thread.
('eeeeeeee-eeee-eeee-eeee-000000000002', 'thread', 'user-1', 'user', 'comment'),
-- user-2 has explicit 'comment' access inherited from p-parent, to test scoping.
('aaaaaaaa-aaaa-aaaa-aaaa-000000000002', 'project', 'user-2', 'user', 'comment');
