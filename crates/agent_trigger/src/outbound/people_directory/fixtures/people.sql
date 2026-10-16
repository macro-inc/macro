INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
    ('00000000-0000-7000-8000-000000000001', 'julia@example.com', 'julia@example.com', 'stripe_julia'),
    ('00000000-0000-7000-8000-000000000002', 'teo@example.com', 'teo@example.com', 'stripe_teo'),
    ('00000000-0000-7000-8000-000000000003', 'nameless@example.com', 'nameless@example.com', 'stripe_nameless');

INSERT INTO "User" (id, email, macro_user_id) VALUES
    ('macro|julia@example.com', 'julia@example.com', '00000000-0000-7000-8000-000000000001'),
    ('macro|teo@example.com', 'teo@example.com', '00000000-0000-7000-8000-000000000002'),
    ('macro|nameless@example.com', 'nameless@example.com', '00000000-0000-7000-8000-000000000003');

-- Teo never set a last name; the nameless user never set either.
INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES
    ('00000000-0000-7000-8000-000000000001', 'Julia', 'Rivera'),
    ('00000000-0000-7000-8000-000000000002', 'Teo', 'N/A');
