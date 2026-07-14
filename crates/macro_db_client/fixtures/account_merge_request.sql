INSERT INTO macro_user (id, email, stripe_customer_id, username)
VALUES ('11111111-1111-1111-1111-111111111111', 'test@macro.com', 'cus_123', 'u1'),
       ('22222222-2222-2222-2222-222222222222', 'test2@macro.com', 'cus_124', 'u2');

INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified)
VALUES ('11111111-1111-1111-1111-111111111111', 'test@macro.com', true),
       ('22222222-2222-2222-2222-222222222222', 'test2@macro.com', true);


INSERT INTO "User" ("id", "email", "macro_user_id")
VALUES ('macro|test@macro.com', 'test@macro.com', '11111111-1111-1111-1111-111111111111'),
       ('macro|test2@macro.com', 'test2@macro.com', '22222222-2222-2222-2222-222222222222');
