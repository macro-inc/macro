INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'language', 'language@test.com', 'cus_language');

INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|language@test.com', 'language@test.com', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);
