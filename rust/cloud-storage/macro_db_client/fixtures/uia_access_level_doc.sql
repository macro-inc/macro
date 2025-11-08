-- Create two users.
-- 'user-1' is the primary user we will test against.
-- 'user-2' has some overlapping permissions to ensure our queries correctly filter by user.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'),
       ('user-2', 'user2@test.com');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
-- Also create an unrelated project to ensure it's not picked up by the query.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent'),
       ('p-unrelated', 'Unrelated Project', 'user-2', NULL);

-- Create two documents.
-- 'd-child' is nested inside the project hierarchy.
-- 'd-standalone' has no project.
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('d-child', 'Nested Document', 'user-1', 'p-parent'),
       ('d-standalone', 'Standalone Document', 'user-2', NULL);

-- Create specific access records in UserItemAccess.
-- This is the core of our test setup.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "granted_from_channel_id")
VALUES
-- Scenario 1: user-1 has DIRECT 'view' access to the nested document 'd-child'.
('10000000-0000-0000-0000-000000000001', 'user-1', 'd-child', 'document', 'view', NULL),

-- Scenario 2: user-1 has INHERITED 'edit' access via the parent project 'p-parent'.
('10000000-0000-0000-0000-000000000002', 'user-1', 'p-parent', 'project', 'edit', NULL),

-- Scenario 3: user-1 has DEEPLY INHERITED 'owner' access via the grandparent project 'p-grandparent'.
('10000000-0000-0000-0000-000000000003', 'user-1', 'p-grandparent', 'project', 'owner', NULL),

-- Scenario 4: user-1 has access to a standalone document, granted via a channel.
('10000000-0000-0000-0000-000000000004', 'user-1', 'd-standalone', 'document', 'comment',
 '20000000-0000-0000-0000-00000000000c'),

-- Scenario 5: user-2 also has access to 'd-child'. This is to ensure our query for user-1 does NOT return this record.
('10000000-0000-0000-0000-000000000005', 'user-2', 'd-child', 'document', 'view', NULL),

-- Scenario 6: user-1 has access to an unrelated project. This should not be returned when querying for 'd-child'.
('10000000-0000-0000-0000-000000000006', 'user-1', 'p-unrelated', 'project', 'edit', NULL);