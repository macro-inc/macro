-- Create macro_user records.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2');

-- Create two users for testing user-scoping.
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'),
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222');

-- Create a nested project hierarchy: p-grandparent -> p-parent -> p-child.
-- Also create an isolated project for the "no access" test case.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('00000000-0000-0000-0000-000000aae002', 'Grandparent Project', 'user-1', NULL),
       ('00000000-0000-0000-0000-000000aae001', 'Parent Project', 'user-1', '00000000-0000-0000-0000-000000aae002'),
       ('00000000-0000-0000-0000-000000aae003', 'Child Project', 'user-1', '00000000-0000-0000-0000-000000aae001'),
       ('00000000-0000-0000-0000-000000aae004', 'Isolated Project', 'user-2', NULL);


-- Create specific access records in entity_access for user-1 across the main hierarchy.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
-- Scenario 1: user-1 has access to all three levels of the project hierarchy.
('00000000-0000-0000-0000-000000aae003'::uuid, 'project', 'user-1', 'user', 'view'),
('00000000-0000-0000-0000-000000aae001'::uuid, 'project', 'user-1', 'user', 'edit'),
('00000000-0000-0000-0000-000000aae002'::uuid, 'project', 'user-1', 'user', 'owner'),

-- Scenario 2: user-2 also has access to the middle project. This is to ensure queries for user-1 are properly scoped.
('00000000-0000-0000-0000-000000aae001'::uuid, 'project', 'user-2', 'user', 'comment'),

-- Scenario 3: user-2 has access to the isolated project, which user-1 does not.
('00000000-0000-0000-0000-000000aae004'::uuid, 'project', 'user-2', 'user', 'owner');
