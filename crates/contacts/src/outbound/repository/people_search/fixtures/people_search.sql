INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'viewer', 'viewer@example.com', 'cus_people_viewer'),
('00000000-0000-4000-8000-000000000002', 'teammate', 'teammate@example.com', 'cus_people_teammate'),
('00000000-0000-4000-8000-000000000003', 'contact', 'contact@example.com', 'cus_people_contact'),
('00000000-0000-4000-8000-000000000004', 'stranger', 'stranger@example.com', 'cus_people_stranger'),
('00000000-0000-4000-8000-000000000005', 'other', 'other@example.com', 'cus_people_other'),
('00000000-0000-4000-8000-000000000006', 'ossam', 'ossam@example.com', 'cus_people_ossam');

-- "ossam" is an agent principal; everyone else is a person.
INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES
('macro|viewer@example.com', 'viewer@example.com', '00000000-0000-4000-8000-000000000001', false),
('macro|teammate@example.com', 'teammate@example.com', '00000000-0000-4000-8000-000000000002', false),
('macro|contact@example.com', 'contact@example.com', '00000000-0000-4000-8000-000000000003', false),
('macro|stranger@example.com', 'stranger@example.com', '00000000-0000-4000-8000-000000000004', false),
('macro|other@example.com', 'other@example.com', '00000000-0000-4000-8000-000000000005', false),
('macro|ossam@example.com', 'ossam@example.com', '00000000-0000-4000-8000-000000000006', true);

INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES
('00000000-0000-4000-8000-000000000001', 'Viewer', 'Person'),
('00000000-0000-4000-8000-000000000002', 'Sam', 'Rivers'),
('00000000-0000-4000-8000-000000000003', 'Sam', 'Rivera'),
('00000000-0000-4000-8000-000000000004', 'Sam', 'Stranger'),
('00000000-0000-4000-8000-000000000005', 'Sam', 'Other'),
('00000000-0000-4000-8000-000000000006', 'Zed', 'N/A');

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-000000000001', 'Viewer team', 'macro|viewer@example.com'),
('00000000-0000-4000-9000-000000000002', 'Other team', 'macro|stranger@example.com');

-- The teammate is not a contact edge: team membership alone makes them searchable.
INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|viewer@example.com', '00000000-0000-4000-9000-000000000001', 'owner'),
('macro|teammate@example.com', '00000000-0000-4000-9000-000000000001', 'member'),
('macro|stranger@example.com', '00000000-0000-4000-9000-000000000002', 'owner'),
('macro|other@example.com', '00000000-0000-4000-9000-000000000002', 'member');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|viewer@example.com', 'people-viewer', 'viewer@example.com', 'GMAIL', true),
('00000000-0000-4000-a000-000000000002', 'macro|stranger@example.com', 'people-stranger', 'stranger@example.com', 'GMAIL', true);

-- Address-book labels are per viewer: the stranger's label never leaks.
INSERT INTO email_contacts (id, link_id, email_address, name) VALUES
('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'samantha.book@example.org', 'Book Sam'),
('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'samantha.book@example.org', 'Stranger Label');

-- Canonical edges (user1 < user2). The stranger knows "other" and a private
-- address; neither is the viewer's contact.
INSERT INTO contacts_connections (user1, user2) VALUES
('macro|contact@example.com', 'macro|viewer@example.com'),
('macro|ossam@example.com', 'macro|viewer@example.com'),
('macro|samantha.book@example.org', 'macro|viewer@example.com'),
('macro|other@example.com', 'macro|stranger@example.com'),
('macro|samuel.private@example.org', 'macro|stranger@example.com');
