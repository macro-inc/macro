-- Fixture for the soup touched-by-me candidate query.
--
-- user-1 is the subject. The activity log gives them a mutation history over
-- documents, chats, projects, channels, and email threads, plus every trap
-- the query must dodge: opened-only entities, other users' activity, deleted
-- and inaccessible entities, left channels, and other users' inboxes.
--
-- user-1's expected feed, newest own-mutation first (T = minute past 10:00):
--   T9 doc-A       (edited   at T9; also created at T1 — group-max wins)
--   T8 chat-A      (messaged at T8; also opened at T20 — views don't count)
--   T7 project-A   (property_changed; unexpanded feeds only)
--   T6 channel-X   (messaged; active participant)
--   T4 thread-Z    (sent; user-1's own inbox link)
--   T2 doc-B       (created; user-2's newer edit must not move it)

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

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'Project A', 'macro|user-1@test.com', NULL, '2023-01-01 10:00:00', '2023-01-01 10:00:00');

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       (3, '11111111-dead-dead-dead-dddddddddddd'),
       (4, '11111111-9999-9999-9999-999999999999'),
       (5, '11111111-5555-5555-5555-555555555555');

INSERT INTO public."Document" ("id", "name", "owner", "projectId", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc A', 'macro|user-1@test.com', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 1, 'pdf', '2023-01-05 10:00:00', '2023-01-05 10:00:00', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Doc B', 'macro|user-1@test.com', NULL, 2, 'docx', '2023-01-05 11:00:00', '2023-01-05 11:00:00', NULL),
       -- Touched at T10 but soft-deleted: must never surface.
       ('11111111-dead-dead-dead-dddddddddddd', 'Deleted Doc', 'macro|user-1@test.com', NULL, 3, 'pdf', '2023-01-05 12:00:00', '2023-01-05 12:00:00', '2024-06-02 00:00:00'),
       -- Touched at T11 but no entity_access row: must never surface.
       ('11111111-9999-9999-9999-999999999999', 'Isolated Doc', 'macro|user-1@test.com', NULL, 4, 'pdf', '2023-01-05 13:00:00', '2023-01-05 13:00:00', NULL),
       -- Only ever opened (T12): views are not touches.
       ('11111111-5555-5555-5555-555555555555', 'Opened Doc', 'macro|user-1@test.com', NULL, 5, 'pdf', '2023-01-05 14:00:00', '2023-01-05 14:00:00', NULL);

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha_A', '2023-01-05 10:00:00', '2023-01-05 10:00:00'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha_B', '2023-01-05 11:00:00', '2023-01-05 11:00:00'),
       (3, '11111111-dead-dead-dead-dddddddddddd', 'sha_dead', '2023-01-05 12:00:00', '2023-01-05 12:00:00'),
       (4, '11111111-9999-9999-9999-999999999999', 'sha_iso', '2023-01-05 13:00:00', '2023-01-05 13:00:00'),
       (5, '11111111-5555-5555-5555-555555555555', 'sha_open', '2023-01-05 14:00:00', '2023-01-05 14:00:00');

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chat A', 'macro|user-1@test.com', NULL, '2023-01-06 10:00:00', '2023-01-06 10:00:00');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'private', 'macro|user-1@test.com', '2023-01-07 10:00:00', '2023-01-07 10:00:00'),
       ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'private', 'macro|user-2@test.com', '2023-01-07 11:00:00', '2023-01-07 11:00:00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member', 'macro|user-1@test.com', '2023-01-07 10:00:00', NULL),
       -- Touched at T5 but user-1 has left: must never surface.
       ('33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', 'macro|user-1@test.com', '2023-01-07 11:00:00', '2024-06-01 00:00:00');

INSERT INTO public.email_links ("id", "macro_id", "fusionauth_user_id", "email_address", "provider")
VALUES ('55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@test.com', 'fa-user-1', 'user@test.com', 'GMAIL'),
       ('55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user-2@test.com', 'fa-user-2', 'user2@test.com', 'GMAIL');

INSERT INTO public.email_threads ("id", "link_id", "inbox_visible", "latest_inbound_message_ts", "created_at", "updated_at")
-- thread-Z is a just-sent thread: not inbox-visible, no inbound reply yet.
-- The touched feed must still carry it (the sender touched it), which is
-- exactly what an inbox-view-filtered hydration would silently drop.
VALUES ('44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE, NULL, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00'),
       -- Touched at T3 but the thread lives in user-2's inbox: must never surface.
       ('44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('aaaaaaaa-ffff-ffff-ffff-ffffffffffff', 'project', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-dead-dead-dead-dddddddddddd', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('11111111-5555-5555-5555-555555555555', 'document', 'macro|user-1@test.com', 'user', 'owner', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@test.com', 'user', 'owner', NULL);

---------------------------------------------------
--  ACTIVITY LOG
---------------------------------------------------

INSERT INTO public.activity_events ("id", "actor_id", "subject_id", "action", "action_payload", "entity_type", "entity_id", "occurred_at")
VALUES
-- doc-A: created T1 then edited T9 — the max mutation (T9) keys the feed.
('ae000000-0000-0000-0000-000000000001', 'macro|user-1@test.com', 'macro|user-1@test.com', 'created', NULL, 'document', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:01:00+00'),
('ae000000-0000-0000-0000-000000000009', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:09:00+00'),
-- doc-B: created T2; user-2's newer edit (T30) must not move user-1's entry.
('ae000000-0000-0000-0000-000000000002', 'macro|user-1@test.com', 'macro|user-1@test.com', 'created', NULL, 'document', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:02:00+00'),
('ae000000-0000-0000-0000-000000000030', 'macro|user-2@test.com', 'macro|user-2@test.com', 'edited', NULL, 'document', '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:30:00+00'),
-- chat-A: messaged T8, opened T20 — the view must not bump it above doc-A.
('ae000000-0000-0000-0000-000000000008', 'macro|user-1@test.com', 'macro|user-1@test.com', 'messaged', NULL, 'chat', '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:08:00+00'),
('ae000000-0000-0000-0000-000000000020', 'macro|user-1@test.com', 'macro|user-1@test.com', 'opened', NULL, 'chat', '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:20:00+00'),
-- project-A: property changed T7 (only unexpanded feeds include projects).
('ae000000-0000-0000-0000-000000000007', 'macro|user-1@test.com', 'macro|user-1@test.com', 'property_changed', '{"property": "p", "from": null, "to": "x"}', 'project', 'aaaaaaaa-ffff-ffff-ffff-ffffffffffff', '2024-06-01 10:07:00+00'),
-- channel-X: messaged T6 (active participant).
('ae000000-0000-0000-0000-000000000006', 'macro|user-1@test.com', 'macro|user-1@test.com', 'messaged', NULL, 'channel', '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:06:00+00'),
-- channel-Y: messaged T5, but user-1 has left the channel.
('ae000000-0000-0000-0000-000000000005', 'macro|user-1@test.com', 'macro|user-1@test.com', 'messaged', NULL, 'channel', '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:05:00+00'),
-- thread-Z: sent T4 (own inbox).
('ae000000-0000-0000-0000-000000000004', 'macro|user-1@test.com', 'macro|user-1@test.com', 'sent', NULL, 'email_thread', '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-06-01 10:04:00+00'),
-- thread-W: edited T3, but it lives in user-2's inbox.
('ae000000-0000-0000-0000-000000000003', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'email_thread', '44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2024-06-01 10:03:00+00'),
-- Deleted doc: edited T10, but the row is soft-deleted.
('ae000000-0000-0000-0000-000000000010', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-dead-dead-dead-dddddddddddd', '2024-06-01 10:10:00+00'),
-- Isolated doc: edited T11, but user-1 has no access row.
('ae000000-0000-0000-0000-000000000011', 'macro|user-1@test.com', 'macro|user-1@test.com', 'edited', NULL, 'document', '11111111-9999-9999-9999-999999999999', '2024-06-01 10:11:00+00'),
-- Opened-only doc: opened T12, never mutated.
('ae000000-0000-0000-0000-000000000012', 'macro|user-1@test.com', 'macro|user-1@test.com', 'opened', NULL, 'document', '11111111-5555-5555-5555-555555555555', '2024-06-01 10:12:00+00');

SET session_replication_role = 'origin';
