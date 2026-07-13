INSERT INTO
    public.macro_user (id, username, email, stripe_customer_id)
VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'newuser', 'new@user.com', 'cus_new');

INSERT INTO
    public."User" (id, email, macro_user_id)
VALUES
    ('macro|new@user.com', 'new@user.com', 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
