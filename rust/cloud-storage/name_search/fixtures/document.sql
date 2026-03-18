-- Test macro_users
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'user1@test.com', 'user1@test.com', 'stripe_user1'),
    ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2'),
    ('a3333333-3333-3333-3333-333333333333', 'user3@test.com', 'user3@test.com', 'stripe_user3');

-- Test users
INSERT INTO "User" (id, email, name, macro_user_id)
VALUES
    ('macro|user1@test.com', 'user1@test.com', 'Test User 1', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|user2@test.com', 'user2@test.com', 'Test User 2', 'a2222222-2222-2222-2222-222222222222'),
    ('macro|user3@test.com', 'user3@test.com', 'Test User 3', 'a3333333-3333-3333-3333-333333333333');

-- Test documents for user1 (owner)
INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt", uploaded)
VALUES
    -- Documents matching "report"
    ('11111111-1111-1111-1111-111111111111', 'Quarterly Report 2024', 'macro|user1@test.com', 'pdf', '2024-01-01 10:00:00', '2024-12-01 10:00:00', true),
    ('22222222-2222-2222-2222-222222222222', 'Sales Report December', 'macro|user1@test.com', 'docx', '2024-02-01 10:00:00', '2024-12-02 10:00:00', true),
    ('33333333-3333-3333-3333-333333333333', 'Financial Report Q3', 'macro|user1@test.com', 'xlsx', '2024-03-01 10:00:00', '2024-12-03 10:00:00', true),

    -- Documents matching "meeting"
    ('44444444-4444-4444-4444-444444444444', 'Team Meeting Notes', 'macro|user1@test.com', 'txt', '2024-04-01 10:00:00', '2024-12-04 10:00:00', true),
    ('55555555-5555-5555-5555-555555555555', 'Client Meeting Agenda', 'macro|user1@test.com', 'pdf', '2024-05-01 10:00:00', '2024-12-05 10:00:00', true),

    -- Documents not matching common search terms
    ('66666666-6666-6666-6666-666666666666', 'Budget Analysis', 'macro|user1@test.com', 'xlsx', '2024-06-01 10:00:00', '2024-12-06 10:00:00', true),
    ('77777777-7777-7777-7777-777777777777', 'Project Proposal', 'macro|user1@test.com', 'docx', '2024-07-01 10:00:00', '2024-12-07 10:00:00', true),

    -- Test case sensitivity (should match "REPORT" search)
    ('88888888-8888-8888-8888-888888888888', 'ANNUAL REPORT 2024', 'macro|user1@test.com', 'pdf', '2024-08-01 10:00:00', '2024-12-08 10:00:00', true);

-- Test documents for user2 (not accessible to user1 unless shared)
INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt", uploaded)
VALUES
    ('99999999-9999-9999-9999-999999999999', 'User2 Report Private', 'macro|user2@test.com', 'pdf', '2024-09-01 10:00:00', '2024-12-09 10:00:00', true),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'User2 Meeting Notes', 'macro|user2@test.com', 'txt', '2024-10-01 10:00:00', '2024-12-10 10:00:00', true);

-- Test documents for user3
INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt", uploaded)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'User3 Report Shared', 'macro|user3@test.com', 'pdf', '2024-11-01 10:00:00', '2024-12-11 10:00:00', true);
