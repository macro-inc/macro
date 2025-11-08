-- Create two users for testing user-scoping.
INSERT INTO public."User" ("id", "email")
VALUES ('user-1', 'user1@test.com'),
       ('user-2', 'user2@test.com');

-- Create a nested project hierarchy: p-grandparent -> p-parent.
INSERT INTO public."Project" ("id", "name", "userId", "parentId")
VALUES ('p-grandparent', 'Grandparent Project', 'user-1', NULL),
       ('p-parent', 'Parent Project', 'user-1', 'p-grandparent');

-- Create two chats.
-- 'chat-child' is nested inside the project hierarchy.
-- 'chat-standalone' has no project.
INSERT INTO public."Chat" ("id", "name", "userId", "projectId")
VALUES ('chat-child', 'Nested Chat', 'user-1', 'p-parent'),
       ('chat-standalone', 'Standalone Chat', 'user-2', NULL);


-- Create specific access records in UserItemAccess.
INSERT INTO public."UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level")
VALUES
-- Scenario 1: user-1 has DIRECT 'view' access to the nested chat 'chat-child'.
('10000000-0000-0000-0000-000000000011', 'user-1', 'chat-child', 'chat', 'view'),

-- Scenario 2: user-1 has INHERITED 'edit' access via the parent project 'p-parent'.
('10000000-0000-0000-0000-000000000012', 'user-1', 'p-parent', 'project', 'edit'),

-- Scenario 3: user-1 has DEEPLY INHERITED 'owner' access via the grandparent project 'p-grandparent'.
('10000000-0000-0000-0000-000000000013', 'user-1', 'p-grandparent', 'project', 'owner'),

-- Scenario 4: user-1 has access to a standalone chat.
('10000000-0000-0000-0000-000000000014', 'user-1', 'chat-standalone', 'chat', 'comment'),

-- Scenario 5: user-2 also has access to 'chat-child'. This is to ensure our query for user-1 does NOT return this record.
('10000000-0000-0000-0000-000000000015', 'user-2', 'chat-child', 'chat', 'view');