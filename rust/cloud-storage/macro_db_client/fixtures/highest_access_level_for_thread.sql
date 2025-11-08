-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."SharePermission", public."EmailThreadPermission", public."ProjectPermission", public."UserItemAccess" RESTART IDENTITY CASCADE;

-- Create users with different permission profiles.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'), -- Has deep explicit access grants.
       ('user-2', 'user2@test.com'), -- Has a single, lower-level explicit grant.
       ('user-public-access-only', 'user3@test.com');
-- Has no explicit grants, relies on public access.

-- Create a nested project hierarchy: p-grandparent -> p-parent.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent');

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
VALUES ('p-grandparent', 'sp-public-edit-thread'),
       ('p-parent', 'sp-public-view-thread');


-- Link threads to projects (or not) via EmailThreadPermission.
INSERT INTO public."EmailThreadPermission" ("threadId", "sharePermissionId", "userId", "projectId")
VALUES ('thread-nested', 'sp-thread-nested', 'user-1', 'p-parent'),   -- Main test subject, in a project
       ('thread-standalone', 'sp-thread-standalone', 'user-1', NULL), -- No project link
       ('thread-private', 'sp-thread-private', 'user-1', NULL);
-- No project link, no permissions


-- Add explicit UserItemAccess records.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- user-1 has explicit 'view' on thread-nested, and inherited 'owner' from p-grandparent.
('10000000-0000-0000-0000-000000000001', 'user-1', 'thread-nested', 'thread', 'view'),
('10000000-0000-0000-0000-000000000002', 'user-1', 'p-grandparent', 'project', 'owner'),
-- user-1 also has direct 'comment' access on the standalone thread.
('10000000-0000-0000-0000-000000000003', 'user-1', 'thread-standalone', 'thread', 'comment'),
-- user-2 has explicit 'comment' access inherited from p-parent, to test scoping.
('10000000-0000-0000-0000-000000000004', 'user-2', 'p-parent', 'project', 'comment');