-- The viewer v ("Viewer Person") is on a team with t ("Zed Samuels"). v's
-- lists: a ("Sam Able", interacted), n ("Bo Osam", invited), g ("Sam Gee",
-- interacted and a Gmail inbox), d ("Sam Dee", Gmail), and an Outlook contact
-- with no account whose address-book label is "Sammy Book"; a Gmail contact
-- whose profile name is empty and whose label is "Eve Label". r ("Sam Reverse")
-- has v but v does not have r; x ("Sam Stranger") is in nobody's lists.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'v', 'v@example.com', 'cus_listed_people_v'),
('00000000-0000-4000-8000-000000000002', 't', 't@example.com', 'cus_listed_people_t'),
('00000000-0000-4000-8000-000000000003', 'a', 'a@example.com', 'cus_listed_people_a'),
('00000000-0000-4000-8000-000000000004', 'n', 'n@example.com', 'cus_listed_people_n'),
('00000000-0000-4000-8000-000000000005', 'g', 'g@example.com', 'cus_listed_people_g'),
('00000000-0000-4000-8000-000000000006', 'd', 'd@example.com', 'cus_listed_people_d'),
('00000000-0000-4000-8000-000000000007', 'r', 'r@example.com', 'cus_listed_people_r'),
('00000000-0000-4000-8000-000000000008', 'x', 'x@example.com', 'cus_listed_people_x'),
('00000000-0000-4000-8000-000000000009', 'e', 'samuel.e@example.org', 'cus_listed_people_e');

INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|v@example.com', 'v@example.com', '00000000-0000-4000-8000-000000000001'),
('macro|t@example.com', 't@example.com', '00000000-0000-4000-8000-000000000002'),
('macro|a@example.com', 'a@example.com', '00000000-0000-4000-8000-000000000003'),
('macro|n@example.com', 'n@example.com', '00000000-0000-4000-8000-000000000004'),
('macro|g@example.com', 'g@example.com', '00000000-0000-4000-8000-000000000005'),
('macro|d@example.com', 'd@example.com', '00000000-0000-4000-8000-000000000006'),
('macro|r@example.com', 'r@example.com', '00000000-0000-4000-8000-000000000007'),
('macro|x@example.com', 'x@example.com', '00000000-0000-4000-8000-000000000008'),
('macro|samuel.e@example.org', 'samuel.e@example.org', '00000000-0000-4000-8000-000000000009');

INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES
('00000000-0000-4000-8000-000000000001', 'Viewer', 'Person'),
('00000000-0000-4000-8000-000000000002', 'Zed', 'Samuels'),
('00000000-0000-4000-8000-000000000003', 'Sam', 'Able'),
('00000000-0000-4000-8000-000000000004', 'Bo', 'Osam'),
('00000000-0000-4000-8000-000000000005', 'Sam', 'Gee'),
('00000000-0000-4000-8000-000000000006', 'Sam', 'Dee'),
('00000000-0000-4000-8000-000000000007', 'Sam', 'Reverse'),
('00000000-0000-4000-8000-000000000008', 'Sam', 'Stranger'),
-- An empty profile name: the viewer's address-book label names them.
('00000000-0000-4000-8000-000000000009', '', NULL);

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-000000000001', 'Viewer team', 'macro|v@example.com');

INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|v@example.com', '00000000-0000-4000-9000-000000000001', 'owner'),
('macro|t@example.com', '00000000-0000-4000-9000-000000000001', 'member');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|v@example.com', 'fa-v', 'v@example.com', 'GMAIL'),
('00000000-0000-4000-a000-000000000002', 'macro|v@example.com', 'fa-v', 'v@example.org', 'OUTLOOK');

INSERT INTO email_contacts (id, link_id, email_address, name) VALUES
('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'sam.o@example.org', 'Sammy Book'),
('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'samuel.e@example.org', 'Eve Label');

INSERT INTO contact_list_members (user_id, contact_user_id, list_key) VALUES
('macro|v@example.com', 'macro|a@example.com', 'interacted'),
('macro|v@example.com', 'macro|n@example.com', 'invited'),
('macro|v@example.com', 'macro|g@example.com', 'interacted'),
-- A list key a later release might write; this one skips it.
('macro|v@example.com', 'macro|a@example.com', 'custom:01900000-0000-7000-8000-000000000001'),
('macro|r@example.com', 'macro|v@example.com', 'interacted');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key) VALUES
('macro|v@example.com', 'macro|g@example.com', '00000000-0000-4000-a000-000000000001', 'gmail'),
('macro|v@example.com', 'macro|d@example.com', '00000000-0000-4000-a000-000000000001', 'gmail'),
('macro|v@example.com', 'macro|sam.o@example.org', '00000000-0000-4000-a000-000000000002', 'outlook'),
('macro|v@example.com', 'macro|samuel.e@example.org', '00000000-0000-4000-a000-000000000001', 'gmail');
