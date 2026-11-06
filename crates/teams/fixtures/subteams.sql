INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES
    ('b1111111-1111-1111-1111-111111111111', 'ada@example.com', 'ada@example.com', 'cus_ada'),
    ('b2222222-2222-2222-2222-222222222222', 'grace@example.com', 'grace@example.com', 'cus_grace'),
    ('b3333333-3333-3333-3333-333333333333', 'linus@example.com', 'linus@example.com', 'cus_linus');

INSERT INTO "User" ("id", "email", "name", "stripeCustomerId", "macro_user_id") VALUES
('macro|ada@example.com', 'ada@example.com', 'Ada', NULL, 'b1111111-1111-1111-1111-111111111111'),
('macro|grace@example.com', 'grace@example.com', 'Grace', NULL, 'b2222222-2222-2222-2222-222222222222'),
('macro|linus@example.com', 'linus@example.com', 'Linus', NULL, 'b3333333-3333-3333-3333-333333333333');

INSERT INTO team (id, name, owner_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Acme', 'macro|ada@example.com'),
       ('22222222-2222-2222-2222-222222222222', 'Globex', 'macro|linus@example.com');

INSERT INTO team_user (team_id, user_id, team_role)
VALUES ('11111111-1111-1111-1111-111111111111', 'macro|ada@example.com', 'owner'),
       ('11111111-1111-1111-1111-111111111111', 'macro|grace@example.com', 'member'),
       ('22222222-2222-2222-2222-222222222222', 'macro|linus@example.com', 'owner');
