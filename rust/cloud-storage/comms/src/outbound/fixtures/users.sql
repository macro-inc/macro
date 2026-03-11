-- Test fixture for PgUserRepo tests
-- Inserts test users with associated user info

-- First insert into macro_user (parent table for both User and macro_user_info)
INSERT INTO "macro_user" (id, username, email, stripe_customer_id) VALUES
    ('11111111-1111-1111-1111-111111111111', 'user1', 'user1@test.com', 'stripe_1'),
    ('22222222-2222-2222-2222-222222222222', 'user2', 'user2@test.com', 'stripe_2'),
    ('33333333-3333-3333-3333-333333333333', 'user3', 'user3@test.com', 'stripe_3');

-- Insert user info (first_name, last_name)
INSERT INTO "macro_user_info" (macro_user_id, first_name, last_name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'John', 'Doe'),
    ('22222222-2222-2222-2222-222222222222', NULL, NULL),
    ('33333333-3333-3333-3333-333333333333', 'Jane', 'Smith');

-- Insert User records (id format: macro|{EMAIL})
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|user1@test.com', 'user1@test.com', '11111111-1111-1111-1111-111111111111'),
    ('macro|user2@test.com', 'user2@test.com', '22222222-2222-2222-2222-222222222222'),
    ('macro|user3@test.com', 'user3@test.com', '33333333-3333-3333-3333-333333333333');
