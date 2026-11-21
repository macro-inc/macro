-- People: a and b share a team; c shares a public channel with a; d has a
-- DM with a message from a; e has an empty DM with a; new signed up and got
-- a support channel with support; gone left a channel after the snapshot;
-- f imported a's address; r was referred by a.
INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
('00000000-0000-4000-8000-000000000001', 'a', 'a@example.com', 'cus_backfill_a'),
('00000000-0000-4000-8000-000000000002', 'b', 'b@example.com', 'cus_backfill_b'),
('00000000-0000-4000-8000-000000000003', 'c', 'c@example.com', 'cus_backfill_c'),
('00000000-0000-4000-8000-000000000004', 'd', 'd@example.com', 'cus_backfill_d'),
('00000000-0000-4000-8000-000000000005', 'e', 'e@example.com', 'cus_backfill_e'),
('00000000-0000-4000-8000-000000000006', 'new', 'new@example.com', 'cus_backfill_new'),
('00000000-0000-4000-8000-000000000007', 'support', 'support@macro.com', 'cus_backfill_support'),
('00000000-0000-4000-8000-000000000008', 'gone', 'gone@example.com', 'cus_backfill_gone'),
('00000000-0000-4000-8000-000000000009', 'f', 'f@example.com', 'cus_backfill_f'),
('00000000-0000-4000-8000-00000000000a', 'r', 'r@example.com', 'cus_backfill_r');

INSERT INTO "User" (id, email, macro_user_id) VALUES
('macro|a@example.com', 'a@example.com', '00000000-0000-4000-8000-000000000001'),
('macro|b@example.com', 'b@example.com', '00000000-0000-4000-8000-000000000002'),
('macro|c@example.com', 'c@example.com', '00000000-0000-4000-8000-000000000003'),
('macro|d@example.com', 'd@example.com', '00000000-0000-4000-8000-000000000004'),
('macro|e@example.com', 'e@example.com', '00000000-0000-4000-8000-000000000005'),
('macro|new@example.com', 'new@example.com', '00000000-0000-4000-8000-000000000006'),
('macro|support@macro.com', 'support@macro.com', '00000000-0000-4000-8000-000000000007'),
('macro|gone@example.com', 'gone@example.com', '00000000-0000-4000-8000-000000000008'),
('macro|f@example.com', 'f@example.com', '00000000-0000-4000-8000-000000000009'),
('macro|r@example.com', 'r@example.com', '00000000-0000-4000-8000-00000000000a');

INSERT INTO team (id, name, owner_id) VALUES
('00000000-0000-4000-9000-000000000001', 'Team', 'macro|a@example.com');
INSERT INTO team_user (user_id, team_id, team_role) VALUES
('macro|a@example.com', '00000000-0000-4000-9000-000000000001', 'owner'),
('macro|b@example.com', '00000000-0000-4000-9000-000000000001', 'member');

INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES
('00000000-0000-4000-c000-000000000001', 'general', 'public', 'macro|a@example.com'),
('00000000-0000-4000-c000-000000000002', 'Macro Support x new', 'private', 'macro|new@example.com'),
('00000000-0000-4000-c000-000000000003', NULL, 'direct_message', 'macro|a@example.com'),
('00000000-0000-4000-c000-000000000004', NULL, 'direct_message', 'macro|a@example.com');

-- A bot row in the public channel is never a contact.
INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES
('00000000-0000-4000-c000-000000000001', 'macro|a@example.com', 'owner'),
('00000000-0000-4000-c000-000000000001', 'macro|c@example.com', 'member'),
('00000000-0000-4000-c000-000000000001', 'bot|helper', 'member'),
('00000000-0000-4000-c000-000000000002', 'macro|new@example.com', 'owner'),
('00000000-0000-4000-c000-000000000002', 'macro|support@macro.com', 'member'),
('00000000-0000-4000-c000-000000000003', 'macro|a@example.com', 'member'),
('00000000-0000-4000-c000-000000000003', 'macro|d@example.com', 'member'),
('00000000-0000-4000-c000-000000000004', 'macro|a@example.com', 'member'),
('00000000-0000-4000-c000-000000000004', 'macro|e@example.com', 'member');

-- The April snapshot still lists gone, and a deleted account.
INSERT INTO contacts_backfill_outbox (comms_channel_id, user_ids, created_at) VALUES
('00000000-0000-4000-c000-000000000001', '["macro|a@example.com", "macro|c@example.com", "macro|gone@example.com", "macro|deleted@example.com"]', '2026-04-29T12:00:00Z');

-- Only the a–d DM has a message from a person; the a–e DM has an imported one.
INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id, import_metadata) VALUES
('00000000-0000-4000-d000-000000000001', 'macro|a@example.com', 'hi', 'channel', '00000000-0000-4000-c000-000000000003', NULL),
('00000000-0000-4000-d000-000000000002', 'macro|e@example.com', 'old', 'channel', '00000000-0000-4000-c000-000000000004', '{"source": "slack"}');

-- a's inbox knows x (not a user) and d; f's inbox knows a.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider) VALUES
('00000000-0000-4000-a000-000000000001', 'macro|a@example.com', '00000000-0000-4000-8000-000000000001', 'a@example.com', 'GMAIL'),
('00000000-0000-4000-a000-000000000002', 'macro|f@example.com', '00000000-0000-4000-8000-000000000009', 'f@example.com', 'OUTLOOK');
INSERT INTO email_contacts (id, link_id, email_address) VALUES
('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'X@example.org'),
('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'd@example.com'),
('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'a@example.com');

-- b once disconnected an inbox.
INSERT INTO email_links_history (link_id, fusionauth_user_id, email_address, provider, deleted_at) VALUES
('00000000-0000-4000-a000-0000000000ff', '00000000-0000-4000-8000-000000000002', 'b-old@example.com', 'GMAIL', '2026-05-01T00:00:00Z');

INSERT INTO referral_tracking (id, referrer_id, referred_id, status) VALUES
('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'complete');

-- Canonical legacy edges (user1 < user2 in byte order).
INSERT INTO contacts_connections (user1, user2) VALUES
('macro|a@example.com', 'macro|b@example.com'),
('macro|a@example.com', 'macro|c@example.com'),
('macro|a@example.com', 'macro|d@example.com'),
('macro|a@example.com', 'macro|e@example.com'),
('macro|a@example.com', 'macro|f@example.com'),
('macro|a@example.com', 'macro|gone@example.com'),
('macro|a@example.com', 'macro|r@example.com'),
('macro|a@example.com', 'macro|x@example.org'),
('macro|b@example.com', 'macro|e@example.com'),
('macro|new@example.com', 'macro|support@macro.com');

-- A referral invite already wrote r into a's invited list; team_user holds
-- b under a legacy-cased id.
INSERT INTO contact_list_members (user_id, contact_user_id, list_key) VALUES
('macro|a@example.com', 'macro|r@example.com', 'invited');
UPDATE "User" SET id = 'macro|B@example.com' WHERE id = 'macro|b@example.com';
