-- The viewer v knows a (interacted and invited), b (interacted) and t
-- (interacted, also a teammate); c and d through a Gmail inbox, d and e through
-- an Outlook inbox. Team members t and a legacy mixed-case id are teammates.
-- s invited v, a interacted with v and g's inbox knows v: they have v, but v
-- does not have s or g.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'v', 'v@example.com', 'cus_directory_v'),
('00000000-0000-4000-8000-000000000002', 't', 't@example.com', 'cus_directory_t'),
('00000000-0000-4000-8000-000000000003', 'legacy', 'Legacy@Example.com', 'cus_directory_legacy'),
('00000000-0000-4000-8000-000000000004', 's', 's@example.com', 'cus_directory_s'),
('00000000-0000-4000-8000-000000000005', 'x', 'x@example.com', 'cus_directory_x');

INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|v@example.com', 'v@example.com', '00000000-0000-4000-8000-000000000001'),
('macro|t@example.com', 't@example.com', '00000000-0000-4000-8000-000000000002'),
('macro|Legacy@Example.com', 'Legacy@Example.com', '00000000-0000-4000-8000-000000000003'),
('macro|s@example.com', 's@example.com', '00000000-0000-4000-8000-000000000004'),
('macro|x@example.com', 'x@example.com', '00000000-0000-4000-8000-000000000005');

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-000000000001', 'Viewer team', 'macro|v@example.com'),
('00000000-0000-4000-9000-000000000002', 'Other team', 'macro|s@example.com');

INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|v@example.com', '00000000-0000-4000-9000-000000000001', 'owner'),
('macro|t@example.com', '00000000-0000-4000-9000-000000000001', 'member'),
('macro|Legacy@Example.com', '00000000-0000-4000-9000-000000000001', 'member'),
('macro|s@example.com', '00000000-0000-4000-9000-000000000002', 'owner'),
('macro|x@example.com', '00000000-0000-4000-9000-000000000002', 'member');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|v@example.com', 'fa-v', 'v@example.com', 'GMAIL'),
('00000000-0000-4000-a000-000000000002', 'macro|v@example.com', 'fa-v', 'v@example.org', 'OUTLOOK'),
('00000000-0000-4000-a000-000000000003', 'macro|g@example.com', 'fa-g', 'g@example.com', 'GMAIL');

INSERT INTO contact_list_members (user_id, contact_user_id, list_key) VALUES
('macro|v@example.com', 'macro|a@example.com', 'interacted'),
('macro|v@example.com', 'macro|a@example.com', 'invited'),
('macro|v@example.com', 'macro|b@example.com', 'interacted'),
-- A list key a later release might write; this one skips it.
('macro|v@example.com', 'macro|b@example.com', 'custom:01900000-0000-7000-8000-000000000001'),
('macro|v@example.com', 'macro|t@example.com', 'interacted'),
('macro|a@example.com', 'macro|v@example.com', 'interacted'),
('macro|s@example.com', 'macro|v@example.com', 'invited'),
('macro|s@example.com', 'macro|z@example.com', 'interacted');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key) VALUES
('macro|v@example.com', 'macro|c@example.com', '00000000-0000-4000-a000-000000000001', 'gmail'),
('macro|v@example.com', 'macro|d@example.com', '00000000-0000-4000-a000-000000000001', 'gmail'),
('macro|v@example.com', 'macro|d@example.com', '00000000-0000-4000-a000-000000000002', 'outlook'),
('macro|v@example.com', 'macro|e@example.com', '00000000-0000-4000-a000-000000000002', 'outlook'),
('macro|g@example.com', 'macro|v@example.com', '00000000-0000-4000-a000-000000000003', 'gmail');
