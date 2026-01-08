-- Test users
INSERT INTO "User" (id, email, name)
VALUES
    ('macro|user1@test.com', 'user1@test.com', 'Test User 1'),
    ('macro|user2@test.com', 'user2@test.com', 'Test User 2'),
    ('macro|user3@test.com', 'user3@test.com', 'Test User 3');

-- Test chats for user1 (userId)
INSERT INTO "Chat" (id, name, "userId", "createdAt", "updatedAt", "deletedAt", model, "isPersistent")
VALUES
    -- Chats matching "project"
    ('11111111-1111-1111-1111-111111111111', 'Project Planning Chat', 'macro|user1@test.com', '2024-01-01 10:00:00', '2024-12-01 10:00:00', NULL, 'gpt-4o', true),
    ('22222222-2222-2222-2222-222222222222', 'Project Review Chat', 'macro|user1@test.com', '2024-02-01 10:00:00', '2024-12-02 10:00:00', NULL, 'gpt-4o', true),

    -- Chats matching "meeting"
    ('33333333-3333-3333-3333-333333333333', 'Team Meeting Chat', 'macro|user1@test.com', '2024-03-01 10:00:00', '2024-12-03 10:00:00', NULL, 'gpt-4o', true),
    ('44444444-4444-4444-4444-444444444444', 'Client Meeting', 'macro|user1@test.com', '2024-04-01 10:00:00', '2024-12-04 10:00:00', NULL, 'gpt-4o', true),

    -- Chats not matching common search terms
    ('55555555-5555-5555-5555-555555555555', 'Budget Discussion', 'macro|user1@test.com', '2024-05-01 10:00:00', '2024-12-05 10:00:00', NULL, 'gpt-4o', true),

    -- Test case sensitivity (should match "PROJECT" search)
    ('66666666-6666-6666-6666-666666666666', 'IMPORTANT PROJECT', 'macro|user1@test.com', '2024-06-01 10:00:00', '2024-12-06 10:00:00', NULL, 'gpt-4o', true),

    -- Soft deleted chat (should be excluded from search results)
    ('77777777-7777-7777-7777-777777777777', 'Deleted Project Chat', 'macro|user1@test.com', '2024-07-01 10:00:00', '2024-12-07 10:00:00', '2024-12-08 10:00:00', 'gpt-4o', true);

-- Test chats for user2 (not accessible to user1 unless shared)
INSERT INTO "Chat" (id, name, "userId", "createdAt", "updatedAt", "deletedAt", model, "isPersistent")
VALUES
    ('88888888-8888-8888-8888-888888888888', 'User2 Project Chat', 'macro|user2@test.com', '2024-08-01 10:00:00', '2024-12-09 10:00:00', NULL, 'gpt-4o', true);

-- Test chats for user3 (used for sharing tests)
INSERT INTO "Chat" (id, name, "userId", "createdAt", "updatedAt", "deletedAt", model, "isPersistent")
VALUES
    ('99999999-9999-9999-9999-999999999999', 'User3 Shared Project', 'macro|user3@test.com', '2024-09-01 10:00:00', '2024-12-10 10:00:00', NULL, 'gpt-4o', true);
