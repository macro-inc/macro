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

-- A team the professional user belongs to (for team-target resolution tests).
INSERT INTO team (id, name, owner_id, seat_count) VALUES
    ('11111111-1111-1111-1111-111111111111', 'pro team', 'macro|pro@user.com', 1);

INSERT INTO team_user (team_id, user_id, team_role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'macro|pro@user.com', 'owner');
