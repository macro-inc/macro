INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'hotkeys', 'hotkeys@example.com', 'cus_hotkeys');

INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|hotkeys@example.com', 'hotkeys@example.com', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid);
