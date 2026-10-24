-- Channel-Y activity for the attention candidate query's keying.
-- Loads after `work_feed`, which creates user-1.
-- (T = minute past 10:00 on 2024-06-01, UTC)
--
--   T30  reaction to user-1's top-level message R1
--   T31  reaction to user-1's reply in thread R2
--   T32  document mention in top-level message R3
--
-- Thread-scoped keying places each at its message's thread, as Home shows
-- them; filed-entity keying places all three at channel-Y.

SET session_replication_role = 'replica';

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'private', 'macro|user-1@test.com', '2023-01-07 10:00:00', '2023-01-07 10:00:00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', 'macro|user-1@test.com', '2023-01-07 10:00:00', NULL);

INSERT INTO public.comms_messages ("id", "parent_entity_type", "parent_entity_id", "thread_id", "sender_id", "content", "created_at", "updated_at")
VALUES ('99999999-1111-1111-1111-111111111111', 'channel', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'macro|user-1@test.com', 'r1', '2024-06-01 10:20:00+00', '2024-06-01 10:20:00+00'),
       ('99999999-2222-2222-2222-222222222222', 'channel', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'macro|user-2@test.com', 'r2', '2024-06-01 10:21:00+00', '2024-06-01 10:21:00+00'),
       ('99999999-2222-2222-2222-aaaaaaaaaaaa', 'channel', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-2222-2222-2222-222222222222', 'macro|user-1@test.com', 'r2 reply', '2024-06-01 10:22:00+00', '2024-06-01 10:22:00+00'),
       ('99999999-3333-3333-3333-333333333333', 'channel', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'macro|user-2@test.com', 'see doc', '2024-06-01 10:23:00+00', '2024-06-01 10:23:00+00');

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id", "secondary_event_item_id", "secondary_event_item_type")
VALUES
('0190b000-0000-7000-8000-000000000030', 'channel_message_reaction', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel', 'test', '2024-06-01 10:30:00', '{"messageId": "99999999-1111-1111-1111-111111111111", "emoji": "+1"}', 'macro|user-2@test.com', '99999999-1111-1111-1111-111111111111', 'channel_message'),
('0190b000-0000-7000-8000-000000000031', 'channel_message_reaction', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel', 'test', '2024-06-01 10:31:00', '{"messageId": "99999999-2222-2222-2222-aaaaaaaaaaaa", "threadId": "99999999-2222-2222-2222-222222222222", "emoji": "+1"}', 'macro|user-2@test.com', '99999999-2222-2222-2222-222222222222', 'channel_message'),
('0190b000-0000-7000-8000-000000000032', 'document_mention', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel', 'test', '2024-06-01 10:32:00', '{"messageId": "99999999-3333-3333-3333-333333333333", "documentName": "Doc A"}', 'macro|user-2@test.com', '99999999-3333-3333-3333-333333333333', 'channel_message');

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "state", "is_important_v0")
VALUES
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000030', '2024-06-01 10:30:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000031', '2024-06-01 10:31:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000032', '2024-06-01 10:32:00', TRUE, NULL, NULL, 'unseen', FALSE);

SET session_replication_role = 'origin';
