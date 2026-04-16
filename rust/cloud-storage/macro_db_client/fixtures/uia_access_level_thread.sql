-- Create macro_user records.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2');

-- Create two users for testing user-scoping.
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'),
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('00000000-0000-0000-0000-000000aae002', 'Grandparent Project', 'user-1', NULL),
       ('00000000-0000-0000-0000-000000aae001', 'Parent Project', 'user-1', '00000000-0000-0000-0000-000000aae002');

-- Create placeholder SharePermission records required for foreign key constraints in EmailThreadPermission.
INSERT INTO public."SharePermission" ("id", "isPublic")
VALUES ('sp-thread-nested', false),
       ('sp-thread-standalone', false);

-- Create the EmailThreadPermission entries. This table links a thread to a user and optionally a project.
INSERT INTO public."EmailThreadPermission" ("threadId", "sharePermissionId", "userId", "projectId")
VALUES
-- 'thread-nested' is part of the project hierarchy.
('e0000000-0000-0000-0000-000000070001', 'sp-thread-nested', 'user-1', '00000000-0000-0000-0000-000000aae001'),
-- 'thread-standalone' is not associated with any project.
('e0000000-0000-0000-0000-000000070002', 'sp-thread-standalone', 'user-2', NULL);


-- Create specific access records in entity_access.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
-- Scenario 1: user-1 has DIRECT 'view' access to the nested thread.
('e0000000-0000-0000-0000-000000070001'::uuid, 'thread', 'user-1', 'user', 'view'),

-- Scenario 2: user-1 has INHERITED 'edit' access via the parent project 'p-parent'.
('00000000-0000-0000-0000-000000aae001'::uuid, 'project', 'user-1', 'user', 'edit'),

-- Scenario 3: user-1 has DEEPLY INHERITED 'owner' access via the grandparent project 'p-grandparent'.
('00000000-0000-0000-0000-000000aae002'::uuid, 'project', 'user-1', 'user', 'owner'),

-- Scenario 4: user-1 has direct access to a standalone thread.
('e0000000-0000-0000-0000-000000070002'::uuid, 'thread', 'user-1', 'user', 'comment'),

-- Scenario 5: user-2 also has access to 'thread-nested'. This is to ensure our query for user-1 does NOT return this record.
('e0000000-0000-0000-0000-000000070001'::uuid, 'thread', 'user-2', 'user', 'view');
