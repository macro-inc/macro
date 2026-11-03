INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('b1111111-1111-1111-1111-111111111111', 'paid-owner@example.com', 'paid-owner@example.com', 'cus_paid_owner'),
    ('b2222222-2222-2222-2222-222222222222', 'paid-member@example.com', 'paid-member@example.com', 'cus_paid_member'),
    ('b3333333-3333-3333-3333-333333333333', 'canceled-owner@example.com', 'canceled-owner@example.com', 'cus_canceled_owner'),
    ('b4444444-4444-4444-4444-444444444444', 'canceled-member@example.com', 'canceled-member@example.com', 'cus_canceled_member');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id")
VALUES
    ('macro|paid-owner@example.com', 'paid-owner@example.com', 'Paid Owner', NULL, 'b1111111-1111-1111-1111-111111111111'),
    ('macro|paid-member@example.com', 'paid-member@example.com', 'Paid Member', NULL, 'b2222222-2222-2222-2222-222222222222'),
    ('macro|canceled-owner@example.com', 'canceled-owner@example.com', 'Canceled Owner', NULL, 'b3333333-3333-3333-3333-333333333333'),
    ('macro|canceled-member@example.com', 'canceled-member@example.com', 'Canceled Member', 'cus_canceled_member', 'b4444444-4444-4444-4444-444444444444');

-- The canceled team keeps the id of its ended subscription, as the Stripe
-- webhook leaves it.
INSERT INTO team (id, name, owner_id, subscription_id, seat_count, paying)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'paid', 'macro|paid-owner@example.com', 'sub_paid', 2, true),
    ('22222222-2222-2222-2222-222222222222', 'canceled', 'macro|canceled-owner@example.com', 'sub_canceled', 2, false);

INSERT INTO team_user (team_id, user_id, team_role)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'macro|paid-owner@example.com', 'owner'),
    ('11111111-1111-1111-1111-111111111111', 'macro|paid-member@example.com', 'member'),
    ('22222222-2222-2222-2222-222222222222', 'macro|canceled-owner@example.com', 'owner'),
    ('22222222-2222-2222-2222-222222222222', 'macro|canceled-member@example.com', 'member');
