INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'a', 'a@example.com', 'cus_fixture_a'),
  ('00000000-0000-4000-8000-00000000000b', 'b', 'b@example.com', 'cus_fixture_b'),
  ('00000000-0000-4000-8000-00000000000c', 'c', 'c@example.com', 'cus_fixture_c'),
  ('00000000-0000-4000-8000-00000000000d', 'd', 'd@example.com', 'cus_fixture_d');

INSERT INTO "User" (id, email, macro_user_id) VALUES
  ('macro|a@example.com', 'a@example.com', '00000000-0000-4000-8000-00000000000a'),
  ('macro|b@example.com', 'b@example.com', '00000000-0000-4000-8000-00000000000b'),
  ('macro|c@example.com', 'c@example.com', '00000000-0000-4000-8000-00000000000c'),
  ('macro|d@example.com', 'd@example.com', '00000000-0000-4000-8000-00000000000d');
