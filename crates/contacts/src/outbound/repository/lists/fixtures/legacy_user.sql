-- An account whose "User" id and address were stored with capitals, before
-- ids were canonicalized to lowercase.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
  ('00000000-0000-4000-8000-00000000000e', 'e', 'E@example.com', 'cus_fixture_e');

INSERT INTO "User" (id, email, macro_user_id) VALUES
  ('macro|E@example.com', 'E@example.com', '00000000-0000-4000-8000-00000000000e');
