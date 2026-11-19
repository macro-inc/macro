INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('60000000-0000-0000-0000-000000000001', 'alice@example.com', 'alice@example.com', 'cus_alice'),
    ('60000000-0000-0000-0000-000000000002', 'bob@example.com', 'bob@example.com', 'cus_bob');
INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|alice@example.com', 'alice@example.com', '60000000-0000-0000-0000-000000000001'),
    ('macro|bob@example.com', 'bob@example.com', '60000000-0000-0000-0000-000000000002');
INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
    ('61000000-0000-0000-0000-000000000001', 'general', 'public', 'macro|alice@example.com'),
    ('61000000-0000-0000-0000-000000000002', 'random', 'public', 'macro|alice@example.com');
