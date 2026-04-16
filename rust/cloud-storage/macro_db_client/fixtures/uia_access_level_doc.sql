-- Create two users.
-- 'user-1' is the primary user we will test against.
-- 'user-2' has some overlapping permissions to ensure our queries correctly filter by user.
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2');

INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-1', 'user1@test.com', 'a1111111-1111-1111-1111-111111111111'),
       ('user-2', 'user2@test.com', 'a2222222-2222-2222-2222-222222222222');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
-- Also create an unrelated project to ensure it's not picked up by the query.
-- IDs are valid UUIDs since entity_access.entity_id is UUID type.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('00000000-0000-0000-0000-000000aae002', 'Grandparent Project', 'user-1', NULL),
       ('00000000-0000-0000-0000-000000aae001', 'Parent Project', 'user-1', '00000000-0000-0000-0000-000000aae002'),
       ('00000000-0000-0000-0000-000000aae003', 'Unrelated Project', 'user-2', NULL);

-- Create two documents.
-- 'd-child' is nested inside the project hierarchy.
-- 'd-standalone' has no project.
INSERT INTO public."Document" ("id", "name", "owner", "projectId")
VALUES ('d0000000-0000-0000-0000-00000000c11d', 'Nested Document', 'user-1', '00000000-0000-0000-0000-000000aae001'),
       ('d0000000-0000-0000-0000-000000057a1d', 'Standalone Document', 'user-2', NULL);

-- Create specific access records in entity_access.
-- source_type is 'user' since these are direct user grants.
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
-- Scenario 1: user-1 has DIRECT 'view' access to the nested document 'd-child'.
('d0000000-0000-0000-0000-00000000c11d'::uuid, 'document', 'user-1', 'user', 'view'),

-- Scenario 2: user-1 has INHERITED 'edit' access via the parent project 'p-parent'.
('00000000-0000-0000-0000-000000aae001'::uuid, 'project', 'user-1', 'user', 'edit'),

-- Scenario 3: user-1 has DEEPLY INHERITED 'owner' access via the grandparent project 'p-grandparent'.
('00000000-0000-0000-0000-000000aae002'::uuid, 'project', 'user-1', 'user', 'owner'),

-- Scenario 4: user-1 has access to a standalone document.
('d0000000-0000-0000-0000-000000057a1d'::uuid, 'document', 'user-1', 'user', 'comment'),

-- Scenario 5: user-2 also has access to 'd-child'. This is to ensure our query for user-1 does NOT return this record.
('d0000000-0000-0000-0000-00000000c11d'::uuid, 'document', 'user-2', 'user', 'view'),

-- Scenario 6: user-1 has access to an unrelated project. This should not be returned when querying for 'd-child'.
('00000000-0000-0000-0000-000000aae003'::uuid, 'project', 'user-1', 'user', 'edit');
