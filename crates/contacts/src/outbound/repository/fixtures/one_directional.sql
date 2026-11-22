-- The viewer has a legacy edge with everyone below. The directed lists say:
--   owner    has the viewer in an inbox; the viewer has nothing for owner
--   inviter  invited the viewer;         the viewer has nothing for inviter
--   mutual   has the viewer in an inbox; the viewer has mutual in an inbox
--   legacy   nothing (written while list writes were off)
--   agent    nothing; a team agent on the viewer's team
--   teammate has the viewer in an inbox; on the viewer's team
-- The viewer's own inbox and invite also name two people with no edge at all.
-- Two more have no list rows: a teammate with no edge, whose legacy team_user
-- id is mixed-case, and a mixed-case legacy peer whose place relative to the
-- folded roster id differs between byte and locale order.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-0000000000a1', 'viewer', 'viewer@example.com', 'cus_dir_viewer'),
('00000000-0000-4000-8000-0000000000a2', 'owner', 'owner@example.com', 'cus_dir_owner'),
('00000000-0000-4000-8000-0000000000a3', 'inviter', 'inviter@example.com', 'cus_dir_inviter'),
('00000000-0000-4000-8000-0000000000a4', 'mutual', 'mutual@example.com', 'cus_dir_mutual'),
('00000000-0000-4000-8000-0000000000a5', 'legacy', 'legacy@example.com', 'cus_dir_legacy'),
('00000000-0000-4000-8000-0000000000a6', 'agent', 'agent@example.com', 'cus_dir_agent'),
('00000000-0000-4000-8000-0000000000a7', 'teammate', 'teammate@example.com', 'cus_dir_teammate'),
('00000000-0000-4000-8000-0000000000a8', 'roster', 'roster@example.com', 'cus_dir_roster');

INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES
('macro|viewer@example.com', 'viewer@example.com', '00000000-0000-4000-8000-0000000000a1', false),
('macro|owner@example.com', 'owner@example.com', '00000000-0000-4000-8000-0000000000a2', false),
('macro|inviter@example.com', 'inviter@example.com', '00000000-0000-4000-8000-0000000000a3', false),
('macro|mutual@example.com', 'mutual@example.com', '00000000-0000-4000-8000-0000000000a4', false),
('macro|legacy@example.com', 'legacy@example.com', '00000000-0000-4000-8000-0000000000a5', false),
('macro|agent@example.com', 'agent@example.com', '00000000-0000-4000-8000-0000000000a6', true),
('macro|teammate@example.com', 'teammate@example.com', '00000000-0000-4000-8000-0000000000a7', false),
('macro|Roster@example.com', 'roster@example.com', '00000000-0000-4000-8000-0000000000a8', false);

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-0000000000a1', 'Viewer team', 'macro|viewer@example.com');

INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|viewer@example.com', '00000000-0000-4000-9000-0000000000a1', 'owner'),
('macro|agent@example.com', '00000000-0000-4000-9000-0000000000a1', 'member'),
('macro|teammate@example.com', '00000000-0000-4000-9000-0000000000a1', 'member'),
('macro|Roster@example.com', '00000000-0000-4000-9000-0000000000a1', 'member');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-0000000000a1', 'macro|viewer@example.com', 'dir-viewer', 'viewer@example.com', 'GMAIL'),
('00000000-0000-4000-a000-0000000000a2', 'macro|owner@example.com', 'dir-owner', 'owner@example.com', 'GMAIL'),
('00000000-0000-4000-a000-0000000000a4', 'macro|mutual@example.com', 'dir-mutual', 'mutual@example.com', 'GMAIL'),
('00000000-0000-4000-a000-0000000000a7', 'macro|teammate@example.com', 'dir-teammate', 'teammate@example.com', 'GMAIL');

INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key) VALUES
('macro|owner@example.com', 'macro|viewer@example.com', '00000000-0000-4000-a000-0000000000a2', 'gmail'),
('macro|mutual@example.com', 'macro|viewer@example.com', '00000000-0000-4000-a000-0000000000a4', 'gmail'),
('macro|viewer@example.com', 'macro|mutual@example.com', '00000000-0000-4000-a000-0000000000a1', 'gmail'),
('macro|teammate@example.com', 'macro|viewer@example.com', '00000000-0000-4000-a000-0000000000a7', 'gmail'),
('macro|viewer@example.com', 'macro|inboxonly@example.com', '00000000-0000-4000-a000-0000000000a1', 'gmail');

INSERT INTO contact_list_members (user_id, contact_user_id, list_key) VALUES
('macro|inviter@example.com', 'macro|viewer@example.com', 'invited'),
('macro|viewer@example.com', 'macro|invitee@example.com', 'invited');

-- Canonical edges (user1 < user2).
INSERT INTO contacts_connections (user1, user2) VALUES
('macro|owner@example.com', 'macro|viewer@example.com'),
('macro|inviter@example.com', 'macro|viewer@example.com'),
('macro|mutual@example.com', 'macro|viewer@example.com'),
('macro|legacy@example.com', 'macro|viewer@example.com'),
('macro|agent@example.com', 'macro|viewer@example.com'),
('macro|teammate@example.com', 'macro|viewer@example.com'),
('macro|Rz@example.com', 'macro|viewer@example.com');
