-- A professional user (has the read:professional_features permission via the
-- seeded `professional_subscriber` role) and a free user (no roles).
INSERT INTO "macro_user" (id, username, email, stripe_customer_id) VALUES
    ('a1111111-1111-1111-1111-111111111111', 'pro@user.com', 'pro@user.com', 'cus_pro'),
    ('a2222222-2222-2222-2222-222222222222', 'free@user.com', 'free@user.com', 'cus_free');

INSERT INTO "User" (id, email, "macro_user_id") VALUES
    ('macro|pro@user.com', 'pro@user.com', 'a1111111-1111-1111-1111-111111111111'),
    ('macro|free@user.com', 'free@user.com', 'a2222222-2222-2222-2222-222222222222');

INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES
    ('macro|pro@user.com', 'professional_subscriber');
