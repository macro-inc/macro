-- Fixture for the soup notified-at candidate query.
--
-- user-1 is the subject. Their notifications span every entity type the feed
-- surfaces, plus every trap the query must dodge: deleted notification rows,
-- other users' notifications, deleted and inaccessible entities, left
-- channels, other users' inboxes/events/foreign entities/reminders,
-- notification types the feed does not roll up, and a malformed entity id.
--
-- user-1's expected feed, latest notification first (T = minute past 10:00):
--   T20 event-E3   (user-2's event on an inbox delegated to user-1)
--   T19 pr-F3      (foreign entity stored for a team user-1 belongs to)
--   T9 doc-A       (notified at T1 and T9 — group-max wins; T9 is not done)
--   T8 chat-A      (marked done — done rows still set the sort key)
--   T7 project-A
--   T6 thread-M    (a mention in channel-X's thread M: primary channel,
--                   secondary channel_message — keyed on the thread root)
--   T5 event-E1    (owned calendar event)
--   T4 thread-Z    (user-1's own inbox link)
--   T3 pr-F1       (foreign entity stored for user-1)
--   T2 reminder-R1
--   T0 channel-X   (a channel-level notification with no secondary item)

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

INSERT INTO public.team ("id", "name", "owner_id")
VALUES ('eeeeeeee-1111-1111-1111-111111111111', 'Team T', 'macro|user-2@test.com');

INSERT INTO public.team_user ("user_id", "team_id", "team_role")
VALUES ('macro|user-1@test.com', 'eeeeeeee-1111-1111-1111-111111111111', 'member');

---------------------------------------------------
--  ENTITIES
---------------------------------------------------

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'Project A', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00');

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       (3, '11111111-dead-dead-dead-dddddddddddd'),
       (4, '11111111-9999-9999-9999-999999999999');

INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc A', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       -- Notified at T12, but the notification row is soft-deleted.
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Doc B', 'macro|user-1@test.com', NULL, 2, 'docx', '2023-01-05 11:00:00', '2023-01-05 11:00:00', NULL),
       -- Notified at T11 but the document is soft-deleted: must never surface.
       ('11111111-dead-dead-dead-dddddddddddd', 'Deleted Doc', 'macro|user-1@test.com', NULL, 3, 'pdf', '2023-01-05 12:00:00', '2023-01-05 12:00:00', '2024-06-02 00:00:00'),
       -- Notified at T10 but no entity_access row: must never surface.
       ('11111111-9999-9999-9999-999999999999', 'Isolated Doc', 'macro|user-1@test.com', NULL, 4, 'pdf', '2023-01-05 13:00:00', '2023-01-05 13:00:00', NULL);

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       (3, '11111111-dead-dead-dead-dddddddddddd', 'sha_dead', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       (4, '11111111-9999-9999-9999-999999999999', 'sha_iso', '2023-01-05 13:00:00', '2023-01-05 13:00:00');

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat A', 'macro|user-1@test.com', NULL, '2023-01-06 10:00:00', '2023-01-06 10:00:00');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'private', 'macro|user-1@test.com', '2023-01-07 10:00:00', '2023-01-07 10:00:00'),
       ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'private', 'macro|user-2@test.com', '2023-01-07 11:00:00', '2023-01-07 11:00:00');

INSERT INTO public.comms_messages ("id", "channel_id", "thread_id", "sender_id", "content", "created_at", "updated_at")
-- thread-M is a root message in channel-X that user-1 was mentioned in.
VALUES ('99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'macro|user-2@test.com', 'hey @user-1', '2024-06-01 10:06:00+00', '2024-06-01 10:06:00+00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member', 'macro|user-1@test.com', '2023-01-07 10:00:00', NULL),
       -- Notified at T13 but user-1 has left: must never surface.
       ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', 'macro|user-1@test.com', '2023-01-07 11:00:00', '2024-06-01 00:00:00');

INSERT INTO public.email_links ("id", "macro_id", "fusionauth_user_id", "email_address", "provider")
VALUES ('55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@test.com', 'fa-user-1', 'user@test.com', 'GMAIL'),
       ('55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user-2@test.com', 'fa-user-2', 'user2@test.com', 'GMAIL'),
       -- user-2's second inbox, delegated to user-1 below.
       ('55555555-cccc-cccc-cccc-cccccccccccc', 'macro|user-2@test.com', 'fa-user-2-shared', 'shared@test.com', 'GMAIL');

INSERT INTO public.macro_user_links ("primary_macro_id", "child_macro_id", "link_id")
VALUES ('macro|user-1@test.com', 'macro|user-2@test.com', '55555555-cccc-cccc-cccc-cccccccccccc');

INSERT INTO public.email_threads ("id", "link_id", "inbox_visible", "is_signal", "latest_inbound_message_ts", "created_at", "updated_at")
-- thread-Z is a signal thread, so an importance=false pre-filter drops it.
VALUES ('44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE, TRUE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00'),
       -- Notified at T14 but the thread lives in user-2's inbox: must never surface.
       ('44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, TRUE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00');

INSERT INTO public.calendar_events ("id", "owner_id", "source_link_id", "ical_uid", "title", "starts_at", "ends_at", "canonical_source_kind", "canonical_source_updated_at")
VALUES ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@test.com', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1@test', 'Event E1', '2024-06-02 10:00:00+00', '2024-06-02 11:00:00+00', 'google', '2024-06-01 09:00:00+00'),
       -- Notified at T15 but owned by user-2 with no delegation: must never surface.
       ('66666666-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user-2@test.com', '55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e2@test', 'Event E2', '2024-06-02 10:00:00+00', '2024-06-02 11:00:00+00', 'google', '2024-06-01 09:00:00+00'),
       -- user-2's event on the inbox delegated to user-1: visible through the delegation.
       ('66666666-cccc-cccc-cccc-cccccccccccc', 'macro|user-2@test.com', '55555555-cccc-cccc-cccc-cccccccccccc', 'e3@test', 'Event E3', '2024-06-02 12:00:00+00', '2024-06-02 13:00:00+00', 'google', '2024-06-01 09:00:00+00');

INSERT INTO public.foreign_entity ("id", "foreign_entity_id", "foreign_entity_source", "metadata", "stored_for_id", "stored_for_auth_entity", "created_at", "updated_at")
VALUES ('77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org/repo#1', 'github_pull_request', '{}', 'macro|user-1@test.com', 'user', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00'),
       -- Notified at T16 but stored for user-2: must never surface.
       ('77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'org/repo#2', 'github_pull_request', '{}', 'macro|user-2@test.com', 'user', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00'),
       -- Stored for Team T, which user-1 belongs to: visible through the team source.
       ('77777777-cccc-cccc-cccc-cccccccccccc', 'org/repo#3', 'github_pull_request', '{}', 'eeeeeeee-1111-1111-1111-111111111111', 'team', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00');

INSERT INTO public.reminder ("id", "user_id", "description", "remind_at", "next_run_at")
VALUES ('88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@test.com', 'Reminder R1', '2024-06-01 10:02:00+00', '2024-06-01 10:02:00+00'),
       -- Notified at T17 but it is user-2's reminder: must never surface.
       ('88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user-2@test.com', 'Reminder R2', '2024-06-01 10:17:00+00', '2024-06-01 10:17:00+00');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-dead-dead-dead-dddddddddddd', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@test.com', 'user', 'owner', NULL);

---------------------------------------------------
--  NOTIFICATIONS
---------------------------------------------------

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id", "secondary_event_item_id", "secondary_event_item_type")
VALUES
-- doc-A: mentioned at T1 then commented on at T9 — the newest keys the feed.
('0190a000-0000-7000-8000-000000000001', 'document_mention', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 10:01:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190a000-0000-7000-8000-000000000009', 'document_comment', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 10:09:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- doc-A for user-2 at T30: another recipient's row must not move user-1's entry.
('0190a000-0000-7000-8000-000000000030', 'document_comment', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 10:30:00', '{}', 'macro|user-1@test.com', NULL, NULL),
-- chat-A at T8 (user-1 marked it done).
('0190a000-0000-7000-8000-000000000008', 'chat_complete', '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'test', '2024-06-01 10:08:00', '{}', NULL, NULL, NULL),
-- project-A at T7.
('0190a000-0000-7000-8000-000000000007', 'project_shared', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', 'test', '2024-06-01 10:07:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- thread-M at T6: a mention, primary channel-X + secondary thread root.
('0190a000-0000-7000-8000-000000000006', 'channel_mention', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel', 'test', '2024-06-01 10:06:00', '{"messageId": "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', 'macro|user-2@test.com', '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel_message'),
-- channel-X at T0: a channel-level notification with no secondary item.
('0190a000-0000-7000-8000-000000000000', 'channel_invite', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'channel', 'test', '2024-06-01 10:00:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- event-E1 at T5 (a fired alarm).
('0190a000-0000-7000-8000-000000000005', 'calendar_event_reminder', '66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'calendar_event', 'test', '2024-06-01 10:05:00', '{}', NULL, NULL, NULL),
-- thread-Z at T4.
('0190a000-0000-7000-8000-000000000004', 'email_received', '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'email_thread', 'test', '2024-06-01 10:04:00', '{}', NULL, NULL, NULL),
-- pr-F1 at T3.
('0190a000-0000-7000-8000-000000000003', 'github_pull_request_event', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'foreign_entity', 'test', '2024-06-01 10:03:00', '{}', NULL, NULL, NULL),
-- reminder-R1 at T2.
('0190a000-0000-7000-8000-000000000002', 'reminder_fired', '88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'reminder', 'test', '2024-06-01 10:02:00', '{}', NULL, NULL, NULL),
-- Isolated doc at T10: user-1 has no access row.
('0190a000-0000-7000-8000-000000000010', 'document_mention', '11111111-9999-9999-9999-999999999999', 'document', 'test', '2024-06-01 10:10:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- Deleted doc at T11: the row is soft-deleted.
('0190a000-0000-7000-8000-000000000011', 'document_mention', '11111111-dead-dead-dead-dddddddddddd', 'document', 'test', '2024-06-01 10:11:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- doc-B at T12: user-1's notification row is deleted.
('0190a000-0000-7000-8000-000000000012', 'document_mention', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'test', '2024-06-01 10:12:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- channel-Y at T13: user-1 has left the channel.
('0190a000-0000-7000-8000-000000000013', 'channel_message', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel', 'test', '2024-06-01 10:13:00', '{}', 'macro|user-2@test.com', NULL, NULL),
-- thread-W at T14: lives in user-2's inbox.
('0190a000-0000-7000-8000-000000000014', 'email_received', '44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'email_thread', 'test', '2024-06-01 10:14:00', '{}', NULL, NULL, NULL),
-- event-E2 at T15: owned by user-2.
('0190a000-0000-7000-8000-000000000015', 'calendar_event_reminder', '66666666-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'calendar_event', 'test', '2024-06-01 10:15:00', '{}', NULL, NULL, NULL),
-- pr-F2 at T16: stored for user-2.
('0190a000-0000-7000-8000-000000000016', 'github_pull_request_event', '77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'foreign_entity', 'test', '2024-06-01 10:16:00', '{}', NULL, NULL, NULL),
-- reminder-R2 at T17: user-2's reminder.
('0190a000-0000-7000-8000-000000000017', 'reminder_fired', '88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'reminder', 'test', '2024-06-01 10:17:00', '{}', NULL, NULL, NULL),
-- A call notification at T18: calls are not part of the feed.
('0190a000-0000-7000-8000-000000000018', 'call_started', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'call', 'test', '2024-06-01 10:18:00', '{}', NULL, NULL, NULL),
-- pr-F3 at T19: stored for user-1's team.
('0190a000-0000-7000-8000-000000000019', 'github_pull_request_event', '77777777-cccc-cccc-cccc-cccccccccccc', 'foreign_entity', 'test', '2024-06-01 10:19:00', '{}', NULL, NULL, NULL),
-- event-E3 at T20: user-2's event on the inbox delegated to user-1.
('0190a000-0000-7000-8000-000000000020', 'calendar_event_reminder', '66666666-cccc-cccc-cccc-cccccccccccc', 'calendar_event', 'test', '2024-06-01 10:20:00', '{}', NULL, NULL, NULL),
-- A channel notification at T21 whose event_item_id is not a uuid: the
-- unconstrained TEXT column admits it, and the gate must drop the row rather
-- than fail the page on the cast.
('0190a000-0000-7000-8000-000000000021', 'channel_invite', 'not-a-uuid', 'channel', 'test', '2024-06-01 10:21:00', '{}', 'macro|user-2@test.com', NULL, NULL);

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "done", "is_important_v0")
VALUES
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000001', '2024-06-01 10:01:00', TRUE, '2024-06-01 10:01:30', NULL, TRUE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000009', '2024-06-01 10:09:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-2@test.com', '0190a000-0000-7000-8000-000000000030', '2024-06-01 10:30:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000008', '2024-06-01 10:08:00', TRUE, '2024-06-01 10:08:30', NULL, TRUE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000007', '2024-06-01 10:07:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000006', '2024-06-01 10:06:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000000', '2024-06-01 10:00:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000005', '2024-06-01 10:05:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000004', '2024-06-01 10:04:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000003', '2024-06-01 10:03:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000002', '2024-06-01 10:02:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000010', '2024-06-01 10:10:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000011', '2024-06-01 10:11:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000012', '2024-06-01 10:12:00', TRUE, NULL, '2024-06-01 10:12:30', FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000013', '2024-06-01 10:13:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000014', '2024-06-01 10:14:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000015', '2024-06-01 10:15:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000016', '2024-06-01 10:16:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000017', '2024-06-01 10:17:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000018', '2024-06-01 10:18:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000019', '2024-06-01 10:19:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000020', '2024-06-01 10:20:00', TRUE, NULL, NULL, FALSE, FALSE),
('macro|user-1@test.com', '0190a000-0000-7000-8000-000000000021', '2024-06-01 10:21:00', TRUE, NULL, NULL, FALSE, FALSE);

SET session_replication_role = 'origin';
