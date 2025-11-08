-- Create two users for testing user-scoping.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'),
       ('user-2', 'user2@test.com');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent');

-- Create placeholder SharePermission records required for foreign key constraints in EmailThreadPermission.
INSERT INTO public."SharePermission" ("id", "isPublic")
VALUES ('sp-thread-nested', false),
       ('sp-thread-standalone', false);

-- Create the EmailThreadPermission entries. This table links a thread to a user and optionally a project.
INSERT INTO public."EmailThreadPermission" ("threadId", "sharePermissionId", "userId", "projectId")
VALUES
-- 'thread-nested' is part of the project hierarchy.
('thread-nested', 'sp-thread-nested', 'user-1', 'p-parent'),
-- 'thread-standalone' is not associated with any project.
('thread-standalone', 'sp-thread-standalone', 'user-2', NULL);


-- Create specific access records in UserItemAccess.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- Scenario 1: user-1 has DIRECT 'view' access to the nested thread.
('10000000-0000-0000-0000-000000000031', 'user-1', 'thread-nested', 'thread', 'view'),

-- Scenario 2: user-1 has INHERITED 'edit' access via the parent project 'p-parent'.
('10000000-0000-0000-0000-000000000032', 'user-1', 'p-parent', 'project', 'edit'),

-- Scenario 3: user-1 has DEEPLY INHERITED 'owner' access via the grandparent project 'p-grandparent'.
('10000000-0000-0000-0000-000000000033', 'user-1', 'p-grandparent', 'project', 'owner'),

-- Scenario 4: user-1 has direct access to a standalone thread.
('10000000-0000-0000-0000-000000000034', 'user-1', 'thread-standalone', 'thread', 'comment'),

-- Scenario 5: user-2 also has access to 'thread-nested'. This is to ensure our query for user-1 does NOT return this record.
('10000000-0000-0000-0000-000000000035', 'user-2', 'thread-nested', 'thread', 'view');