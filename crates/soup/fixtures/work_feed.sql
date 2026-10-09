-- Fixture for the soup work feed candidate query.
--
-- user-1 is the subject. Each entity exercises one rule of the merge between
-- attention (live notifications, one not done) and own work (latest non-view
-- activity).
-- (T = minute past 10:00 on 2024-06-01, UTC)
--
--   thread-S  sent by user-1 at T13; its T0 notification does not count
--             because the thread is not in the inbox     -> own        T13
--   thread-Z  in the inbox, notified at T12               -> attention  T12
--   channel-X user-1 messaged at T11                      -> own        T11
--   doc-A     notified at T5, edited at T9                -> own        T9
--   doc-B     notified at T8, edited at T3                -> attention  T8
--   doc-G     notified at T8 (ties doc-B; id breaks it)   -> attention  T8
--   doc-C     edited at T7, never notified                -> own        T7
--   chat-A    notified at T4                              -> attention  T4
--   doc-E     only notification is done (T10), edited T2  -> own        T2
--   thread-M  a mention in channel-X's thread M at T1     -> attention  T1
--
-- Never surfaced: doc-F (only opened), thread-A (archived, notified T14),
-- and user-2's activity.

SET session_replication_role = 'replica';

INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@test.com', 'user@test.com', 'stripe_id_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_id_2');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@test.com', 'user@test.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111'),
       ('macro|user-2@test.com', 'user2@test.com', 'stripe_id_2', 1, 'a2222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

---------------------------------------------------
--  ENTITIES
---------------------------------------------------

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       (3, '11111111-cccc-cccc-cccc-cccccccccccc'),
       (5, '11111111-eeee-eeee-eeee-eeeeeeeeeeee'),
       (6, '11111111-ffff-ffff-ffff-ffffffffffff'),
       (7, '11111111-0000-0000-0000-000000000000');

INSERT INTO public."Document" ("id", "name", "owner", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc A', 'macro|user-1@test.com', 1, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Doc B', 'macro|user-1@test.com', 2, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'Doc C', 'macro|user-1@test.com', 3, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'Doc E', 'macro|user-1@test.com', 5, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-ffff-ffff-ffff-ffffffffffff', 'Doc F', 'macro|user-1@test.com', 6, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-0000-0000-0000-000000000000', 'Doc G', 'macro|user-2@test.com', 7, 'md', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL);

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat A', 'macro|user-1@test.com', NULL, '2023-01-06 10:00:00', '2023-01-06 10:00:00');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'private', 'macro|user-1@test.com', '2023-01-07 10:00:00', '2023-01-07 10:00:00');

INSERT INTO public.comms_messages ("id", "parent_entity_type", "parent_entity_id", "thread_id", "sender_id", "content", "created_at", "updated_at")
VALUES ('99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'macro|user-2@test.com', 'hey @user-1', '2024-06-01 10:01:00+00', '2024-06-01 10:01:00+00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member', 'macro|user-1@test.com', '2023-01-07 10:00:00', NULL);

INSERT INTO public.email_links ("id", "macro_id", "fusionauth_user_id", "email_address", "provider")
VALUES ('55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@test.com', 'fa-user-1', 'user@test.com', 'GMAIL');

INSERT INTO public.email_threads ("id", "link_id", "inbox_visible", "is_signal", "latest_inbound_message_ts", "created_at", "updated_at")
VALUES ('44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE, TRUE, '2024-06-01 10:12:00+00', '2024-06-01 10:12:00+00', '2024-06-01 10:12:00+00'),
       -- thread-S: sent by user-1, not in the inbox.
       ('44444444-5555-5555-5555-555555555555', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE, TRUE, NULL, '2024-06-01 10:13:00+00', '2024-06-01 10:13:00+00'),
       -- thread-A: archived.
       ('44444444-0000-0000-0000-000000000000', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE, TRUE, '2024-06-01 10:14:00+00', '2024-06-01 10:14:00+00', '2024-06-01 10:14:00+00');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-ffff-ffff-ffff-ffffffffffff', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-0000-0000-0000-000000000000', 'document', 'macro|user-1@test.com', 'user', 'view', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@test.com', 'user', 'owner', NULL);

---------------------------------------------------
--  NOTIFICATIONS
---------------------------------------------------

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id", "secondary_event_item_id", "secondary_event_item_type")
VALUES
('0190b000-0000-7000-8000-000000000005', 'document_mention', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 10:05:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000008', 'document_mention', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'test', '2024-06-01 10:08:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000108', 'document_mention', '11111111-0000-0000-0000-000000000000', 'document', 'test', '2024-06-01 10:08:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000004', 'ai_response', '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'test', '2024-06-01 10:04:00', '{}', NULL, NULL, NULL),
('0190b000-0000-7000-8000-000000000010', 'document_mention', '11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'document', 'test', '2024-06-01 10:10:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000001', 'channel_mention', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel', 'test', '2024-06-01 10:01:00', '{"messageId": "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', 'macro|user-2@test.com', '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel_message'),
('0190b000-0000-7000-8000-000000000012', 'new_email', '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'email_thread', 'test', '2024-06-01 10:12:00', '{}', NULL, NULL, NULL),
('0190b000-0000-7000-8000-000000000000', 'new_email', '44444444-5555-5555-5555-555555555555', 'email_thread', 'test', '2024-06-01 10:00:00', '{}', NULL, NULL, NULL),
('0190b000-0000-7000-8000-000000000014', 'new_email', '44444444-0000-0000-0000-000000000000', 'email_thread', 'test', '2024-06-01 10:14:00', '{}', NULL, NULL, NULL);

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "state", "is_important_v0")
VALUES
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000005', '2024-06-01 10:05:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000008', '2024-06-01 10:08:00', TRUE, NULL, NULL, 'seen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000108', '2024-06-01 10:08:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000004', '2024-06-01 10:04:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000010', '2024-06-01 10:10:00', TRUE, NULL, NULL, 'done', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000001', '2024-06-01 10:01:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000012', '2024-06-01 10:12:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000000', '2024-06-01 10:00:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000014', '2024-06-01 10:14:00', TRUE, NULL, NULL, 'unseen', FALSE);

---------------------------------------------------
--  OWN ACTIVITY
---------------------------------------------------

INSERT INTO public.activity_events ("id", "actor_id", "subject_id", "action", "action_payload", "entity_type", "entity_id", "occurred_at")
VALUES
('0190c000-0000-7000-8000-000000000009', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:09:00+00'),
('0190c000-0000-7000-8000-000000000003', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:03:00+00'),
('0190c000-0000-7000-8000-000000000007', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-cccc-cccc-cccc-cccccccccccc', '2024-06-01 10:07:00+00'),
('0190c000-0000-7000-8000-000000000002', 'macro|user-1@test.com', 'macro|user-1@test.com', 'created', NULL, 'document', '11111111-eeee-eeee-eeee-eeeeeeeeeeee', '2024-06-01 10:02:00+00'),
('0190c000-0000-7000-8000-000000000015', 'macro|user-1@test.com', 'macro|user-1@test.com', 'opened', NULL, 'document', '11111111-ffff-ffff-ffff-ffffffffffff', '2024-06-01 10:15:00+00'),
('0190c000-0000-7000-8000-000000000011', 'macro|user-1@test.com', 'macro|user-1@test.com', 'messaged', NULL, 'channel', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:11:00+00'),
('0190c000-0000-7000-8000-000000000013', 'macro|user-1@test.com', 'macro|user-1@test.com', 'sent', NULL, 'email_thread', '44444444-5555-5555-5555-555555555555', '2024-06-01 10:13:00+00'),
-- Opening doc-A after editing it must not move it.
('0190c000-0000-7000-8000-000000000016', 'macro|user-1@test.com', 'macro|user-1@test.com', 'opened', NULL, 'document', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:16:00+00'),
-- user-2's newer edit of doc-B is not user-1's own work.
('0190c000-0000-7000-8000-000000000020', 'macro|user-2@test.com', 'macro|user-2@test.com', 'edited', NULL, 'document', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:20:00+00'),
-- Archiving thread-A records an edit, which is triage, not own work.
('0190c000-0000-7000-8000-000000000017', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'email_thread', '44444444-0000-0000-0000-000000000000', '2024-06-01 10:17:00+00'),
-- Archiving thread-S after sending must not move it from its send.
('0190c000-0000-7000-8000-000000000018', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'email_thread', '44444444-5555-5555-5555-555555555555', '2024-06-01 10:18:00+00');

SET session_replication_role = 'origin';
