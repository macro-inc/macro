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
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent'),
       ('p-child', 'Child Project', 'user-1', 'p-parent'),
       ('p-isolated', 'Isolated Project', 'user-2', NULL);


-- Create specific access records in UserItemAccess for user-1 across the main hierarchy.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- Scenario 1: user-1 has access to all three levels of the project hierarchy.
('10000000-0000-0000-0000-000000000021', 'user-1', 'p-child', 'project', 'view'),
('10000000-0000-0000-0000-000000000022', 'user-1', 'p-parent', 'project', 'edit'),
('10000000-0000-0000-0000-000000000023', 'user-1', 'p-grandparent', 'project', 'owner'),

-- Scenario 2: user-2 also has access to the middle project. This is to ensure queries for user-1 are properly scoped.
('10000000-0000-0000-0000-000000000024', 'user-2', 'p-parent', 'project', 'comment'),

-- Scenario 3: user-2 has access to the isolated project, which user-1 does not.
('10000000-0000-0000-0000-000000000025', 'user-2', 'p-isolated', 'project', 'owner');