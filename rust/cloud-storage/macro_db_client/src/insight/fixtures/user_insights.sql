-- Insert a test user (required for foreign key constraint)
INSERT INTO "User" (id, email) VALUES ('macro|user1@macro.com', 'user1@macro.com');

-- Insert two user insights for the test user
INSERT INTO "UserInsights" (
    id, "userId", content, source, generated, confidence
) VALUES
    ('insight1', 'macro|user1@macro.com', 'Insight content 1', 'test_source', true, 5),
    ('insight2', 'macro|user1@macro.com', 'Insight content 2', 'test_source', false, 1); 