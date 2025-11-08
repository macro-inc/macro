-- Clean up all relevant tables to ensure a fresh state for each test.
TRUNCATE TABLE public."User", public."Project", public."Document", public."SharePermission", public."DocumentPermission", public."ProjectPermission", public."UserItemAccess" RESTART IDENTITY CASCADE;

-- Create three users.
-- user-1: The primary user we will test against, has many explicit permissions.
-- user-2: Has some overlapping explicit permissions to test user scoping.
-- user-public-access-only: Has no explicit permissions, to test reliance on public access.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'),
       ('user-2', 'user2@test.com'),
       ('user-3', 'user3@test.com'),
       ('user-public-access-only', 'user4@test.com');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent');

-- Create documents.
-- d-child: Nested inside the project hierarchy.
-- d-standalone: Has no project.
-- d-private: Has no permissions of any kind attached.
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('d-child', 'Nested Document', 'user-1', 'p-parent'),
       ('d-standalone', 'Standalone Document', 'user-2', NULL),
       ('d-private', 'Private Document', 'user-1', NULL);

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
VALUES ('p-grandparent', 'sp-public-edit'),
       ('p-parent', 'sp-public-view');

-- Link the private share permission to the document to test the "isPublic" filter.
INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('d-child', 'sp-private-owner');


-- Add explicit UserItemAccess records
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- user-1 has explicit 'view' on d-child, 'edit' on p-parent, and 'owner' on p-grandparent.
-- The highest explicit access for user-1 on d-child is therefore 'owner'.
('10000000-0000-0000-0000-000000000001', 'user-1', 'd-child', 'document', 'view'),
('10000000-0000-0000-0000-000000000002', 'user-1', 'p-parent', 'project', 'edit'),
('10000000-0000-0000-0000-000000000003', 'user-1', 'p-grandparent', 'project', 'owner'),

-- user-1 also has 'comment' access on the standalone document.
('10000000-0000-0000-0000-000000000004', 'user-1', 'd-standalone', 'document', 'comment'),

-- user-2 has explicit 'view' on d-child, to test that the query correctly filters by user.
('10000000-0000-0000-0000-000000000005', 'user-2', 'd-child', 'document', 'view'),


('10000000-0000-0000-0000-000000000006', 'user-3', 'd-standalone', 'document', 'edit');