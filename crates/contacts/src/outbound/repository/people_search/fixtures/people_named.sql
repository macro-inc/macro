INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'viewer', 'viewer@example.com', 'cus_named_viewer'),
('00000000-0000-4000-8000-000000000002', 'terot', 'tero.t@example.com', 'cus_named_teammate'),
('00000000-0000-4000-8000-000000000003', 'nyland', 'nyland@example.com', 'cus_named_nyland'),
('00000000-0000-4000-8000-000000000004', 'abbott', 'abbott@example.com', 'cus_named_abbott'),
('00000000-0000-4000-8000-000000000005', 'stone', 'stone@example.com', 'cus_named_stone'),
('00000000-0000-4000-8000-000000000006', 'teague', 'teague@example.com', 'cus_named_teague'),
('00000000-0000-4000-8000-000000000007', 'nameless', 'nameless@example.com', 'cus_named_nameless'),
('00000000-0000-4000-8000-000000000008', 'stranger', 'stranger@example.com', 'cus_named_stranger'),
('00000000-0000-4000-8000-000000000009', 'terostranger', 'tero.stranger@example.com', 'cus_named_tero_stranger');

INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|viewer@example.com', 'viewer@example.com', '00000000-0000-4000-8000-000000000001'),
('macro|tero.t@example.com', 'tero.t@example.com', '00000000-0000-4000-8000-000000000002'),
('macro|nyland@example.com', 'nyland@example.com', '00000000-0000-4000-8000-000000000003'),
('macro|abbott@example.com', 'abbott@example.com', '00000000-0000-4000-8000-000000000004'),
('macro|stone@example.com', 'stone@example.com', '00000000-0000-4000-8000-000000000005'),
('macro|teague@example.com', 'teague@example.com', '00000000-0000-4000-8000-000000000006'),
('macro|nameless@example.com', 'nameless@example.com', '00000000-0000-4000-8000-000000000007'),
('macro|stranger@example.com', 'stranger@example.com', '00000000-0000-4000-8000-000000000008'),
('macro|tero.stranger@example.com', 'tero.stranger@example.com', '00000000-0000-4000-8000-000000000009');

-- "nameless" has a profile row without a name, so the viewer's label names them.
INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES
('00000000-0000-4000-8000-000000000001', 'Viewer', 'Person'),
('00000000-0000-4000-8000-000000000002', 'Tero', 'Teammate'),
('00000000-0000-4000-8000-000000000003', 'Tero', 'Nyland'),
('00000000-0000-4000-8000-000000000004', 'Tero', 'Abbott'),
('00000000-0000-4000-8000-000000000005', 'Peter', 'Stone'),
('00000000-0000-4000-8000-000000000006', 'Quinn', 'Teague'),
('00000000-0000-4000-8000-000000000007', NULL, 'N/A'),
('00000000-0000-4000-8000-000000000008', 'Sam', 'Stranger'),
('00000000-0000-4000-8000-000000000009', 'Tero', 'Stranger');

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-000000000001', 'Viewer team', 'macro|viewer@example.com');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|viewer@example.com', '00000000-0000-4000-9000-000000000001', 'owner'),
('macro|tero.t@example.com', '00000000-0000-4000-9000-000000000001', 'member');

-- The viewer has two mailboxes; the one whose id sorts first names Tessa.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|viewer@example.com', 'named-viewer-1', 'viewer@example.com', 'GMAIL', true),
('00000000-0000-4000-a000-000000000002', 'macro|viewer@example.com', 'named-viewer-2', 'viewer.two@example.com', 'GMAIL', true),
('00000000-0000-4000-a000-000000000003', 'macro|stranger@example.com', 'named-stranger', 'stranger@example.com', 'GMAIL', true);

INSERT INTO email_contacts (id, link_id, email_address, name) VALUES
('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'tessa.book@example.org', 'Other Label'),
('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'tessa.book@example.org', 'Tessa Book'),
('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000001', 'nameless@example.com', 'Terodora Label'),
('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000001', 'nyland@example.com', 'Ignored Label'),
-- Labels are per viewer: the stranger's label for the viewer's contact never names them.
('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000003', 'unlabeled@example.org', 'Tero Leak');

-- Canonical edges (user1 < user2). The legacy edge in capitals folds to the
-- canonical id. The stranger's contact is not the viewer's.
INSERT INTO contacts_connections (user1, user2) VALUES
('macro|nyland@example.com', 'macro|viewer@example.com'),
('macro|abbott@example.com', 'macro|viewer@example.com'),
('macro|stone@example.com', 'macro|viewer@example.com'),
('macro|teague@example.com', 'macro|viewer@example.com'),
('macro|nameless@example.com', 'macro|viewer@example.com'),
('macro|tessa.book@example.org', 'macro|viewer@example.com'),
('macro|tero.nolabel@example.org', 'macro|viewer@example.com'),
('macro|TERO.CASE@example.org', 'macro|viewer@example.com'),
('macro|unlabeled@example.org', 'macro|viewer@example.com'),
('macro|stranger@example.com', 'macro|tero.stranger@example.com');
