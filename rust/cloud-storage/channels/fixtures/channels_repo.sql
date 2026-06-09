-- Fixture for channels outbound repo integration tests.
--
-- Channel: ch1 (public, in org 1)
-- Top-level messages: msg1 (oldest), msg2, msg3 (newest)
-- msg1 has a thread with 4 replies (r1..r4), reactions, and an attachment
-- msg2 is soft-deleted but has an active reply → should still appear in message listings
-- but its attachments should not appear in the channel attachments endpoint
-- msg3 is a normal message with no thread
--
-- Also:
-- deleted_msg: soft-deleted with no active replies → should NOT appear
-- Channel: ch2 (separate channel for isolation tests)
-- Participants: owner, admin, member (active), left_user (left)

-- channels
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'test-channel', 'public', NULL, 'macro|user-a@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00'),
  ('00000000-0000-0000-0000-000000000c02', 'other-channel', 'public', NULL, 'macro|user-b@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

-- top-level messages in ch1 (thread_id IS NULL)
INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, edited_at, deleted_at) VALUES
  -- msg1: oldest, has thread
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000c01', NULL,
   'macro|user-a@test.com', 'first message', '2024-01-01 10:00:00+00', '2024-01-01 10:00:00+00', NULL, NULL),
  -- msg2: soft-deleted but has active reply → should appear
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000c01', NULL,
   'macro|user-b@test.com', 'deleted with reply', '2024-01-01 11:00:00+00', '2024-01-01 11:00:00+00', NULL, '2024-01-02 00:00:00'),
  -- msg3: newest, edited
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000c01', NULL,
   'macro|user-a@test.com', 'third message edited', '2024-01-01 12:00:00+00', '2024-01-01 13:00:00+00', '2024-01-01 13:00:00', NULL),
  -- deleted_msg: soft-deleted with NO active replies → should NOT appear
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000c01', NULL,
   'macro|user-a@test.com', 'fully deleted', '2024-01-01 09:00:00+00', '2024-01-01 09:00:00+00', NULL, '2024-01-02 00:00:00'),
  -- message in ch2 for isolation
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000c02', NULL,
   'macro|user-b@test.com', 'other channel msg', '2024-01-01 10:00:00+00', '2024-01-01 10:00:00+00', NULL, NULL);

-- thread replies under msg1 (4 replies)
INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, edited_at, deleted_at) VALUES
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000001', 'macro|user-b@test.com', 'reply 1',
   '2024-01-01 10:01:00+00', '2024-01-01 10:01:00+00', NULL, NULL),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000001', 'macro|user-a@test.com', 'reply 2',
   '2024-01-01 10:02:00+00', '2024-01-01 10:02:00+00', NULL, NULL),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000001', 'macro|user-b@test.com', 'reply 3',
   '2024-01-01 10:03:00+00', '2024-01-01 10:03:00+00', NULL, NULL),
  ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000001', 'macro|user-a@test.com', 'reply 4',
   '2024-01-01 10:04:00+00', '2024-01-01 10:04:00+00', NULL, NULL);

-- active reply under msg2 (the deleted parent)
INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, edited_at, deleted_at) VALUES
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000002', 'macro|user-a@test.com', 'reply to deleted',
   '2024-01-01 11:01:00+00', '2024-01-01 11:01:00+00', NULL, NULL);

-- deleted reply under deleted_msg (no active replies)
INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, edited_at, deleted_at) VALUES
  ('00000000-0000-0000-0000-00000000b006', '00000000-0000-0000-0000-000000000c01',
   '00000000-0000-0000-0000-000000000004', 'macro|user-b@test.com', 'also deleted reply',
   '2024-01-01 09:01:00+00', '2024-01-01 09:01:00+00', NULL, '2024-01-02 00:00:00');

-- reactions on msg1
INSERT INTO comms_reactions (message_id, emoji, user_id, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '👍', 'macro|user-a@test.com', '2024-01-01 10:10:00+00'),
  ('00000000-0000-0000-0000-000000000001', '👍', 'macro|user-b@test.com', '2024-01-01 10:11:00+00'),
  ('00000000-0000-0000-0000-000000000001', '🎉', 'macro|user-a@test.com', '2024-01-01 10:12:00+00');

-- reactions on msg3
INSERT INTO comms_reactions (message_id, emoji, user_id, created_at) VALUES
  ('00000000-0000-0000-0000-000000000003', '👍', 'macro|user-b@test.com', '2024-01-01 12:10:00+00');

-- attachments on msg1
INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height, created_at) VALUES
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000c01', 'document', 'doc-1', NULL, NULL, '2024-01-01 10:00:00+00'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000c01', 'image', 'img-1', 800, 600, '2024-01-01 10:00:01+00');

-- attachment on msg3
INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height, created_at) VALUES
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000c01', 'document', 'doc-2', NULL, NULL, '2024-01-01 12:00:00+00');

-- attachment on deleted msg2: should be excluded from channel-level attachments
INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height, created_at) VALUES
  ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000c01', 'image', 'img-deleted', 640, 480, '2024-01-01 11:00:30+00');

-- participants in ch1
INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-a@test.com', 'owner', '2024-01-01 00:00:00+00', NULL),
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-b@test.com', 'admin', '2024-01-01 00:01:00+00', NULL),
  ('00000000-0000-0000-0000-000000000c01', 'macro|user-c@test.com', 'member', '2024-01-01 00:02:00+00', NULL),
  ('00000000-0000-0000-0000-000000000c01', 'macro|left-user@test.com', 'member', '2024-01-01 00:03:00+00', '2024-01-05 00:00:00+00');

-- Channel ch3: isolated thread-recipient correctness fixture.
-- A departed participant (left-user) authored a reply in a thread whose parent
-- was authored by an active participant (user-a). The departed sender must be
-- excluded from thread recipient/notification lookups, while the active sender
-- is still included.
INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000c03', 'thread-recipients', 'public', NULL, 'macro|user-a@test.com',
   '2024-01-01 00:00:00+00', '2024-01-01 00:00:00+00');

INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content, created_at, updated_at, edited_at, deleted_at) VALUES
  -- thread parent authored by an active participant
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000c03', NULL,
   'macro|user-a@test.com', 'thread parent', '2024-01-01 10:00:00+00', '2024-01-01 10:00:00+00', NULL, NULL),
  -- reply authored by a participant who later left the channel
  ('00000000-0000-0000-0000-00000000b031', '00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-000000000031', 'macro|left-user@test.com', 'reply from departed user',
   '2024-01-01 10:01:00+00', '2024-01-01 10:01:00+00', NULL, NULL);

INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at, left_at) VALUES
  ('00000000-0000-0000-0000-000000000c03', 'macro|user-a@test.com', 'owner', '2024-01-01 00:00:00+00', NULL),
  ('00000000-0000-0000-0000-000000000c03', 'macro|left-user@test.com', 'member', '2024-01-01 00:03:00+00', '2024-01-05 00:00:00+00');

-- entity mentions (used by attachment-references tests)
-- doc-mention is mentioned inside msg3 (a message source → channel reference, gated by participation)
-- doc-generic is mentioned by a non-message source (doc → generic reference, not gated)
-- doc-2 already has a direct attachment on msg3 (a003, 12:00); this newer generic mention
--   lets the merge/sort test assert generic-before-channel ordering
INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'message', '00000000-0000-0000-0000-000000000003',
   'document', 'doc-mention', 'macro|user-a@test.com', '2024-01-01 12:00:00+00'),
  ('00000000-0000-0000-0000-00000000e002', 'doc', 'src-doc',
   'document', 'doc-generic', 'macro|user-a@test.com', '2024-01-03 00:00:00+00'),
  ('00000000-0000-0000-0000-00000000e003', 'doc', 'src-doc-2',
   'document', 'doc-2', 'macro|user-a@test.com', '2024-01-04 00:00:00+00');
