-- Runtime (harness) access notifications for the attention candidate query.
-- Loads after `work_feed`, which creates user-1 and user-2.
-- (T = minute past 10:00 on 2024-06-01, UTC)
--
--   T50  user-2 asked for user-1's runtime-1                   -> listed
--   T51  user-2 granted user-1 their runtime-2 (same team)      -> listed
--   T52  a request on user-3's runtime-3 (another team)         -> not listed
--   T53  a request on user-1's deleted runtime-4                -> not listed

SET session_replication_role = 'replica';

INSERT INTO public.team ("id", "name", "owner_id")
VALUES ('77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Team 1', 'macro|user-1@example.com'),
       ('77777777-cccc-cccc-cccc-cccccccccccc', 'Team 3', 'macro|user-3@example.com');

INSERT INTO public.team_user ("user_id", "team_id", "team_role")
VALUES ('macro|user-1@example.com', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
       ('macro|user-2@example.com', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
       ('macro|user-3@example.com', '77777777-cccc-cccc-cccc-cccccccccccc', 'owner');

INSERT INTO public.harnesses ("id", "name", "owner_user_id", "created_by", "created_at", "updated_at", "deleted_at")
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'runtime-1', 'macro|user-1@example.com', 'macro|user-1@example.com', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', NULL),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'runtime-2', 'macro|user-2@example.com', 'macro|user-2@example.com', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', NULL),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'runtime-3', 'macro|user-3@example.com', 'macro|user-3@example.com', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', NULL),
       ('aaaaaaaa-0000-0000-0000-000000000004', 'runtime-4', 'macro|user-1@example.com', 'macro|user-1@example.com', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', '2024-06-01 09:30:00+00');

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id")
VALUES ('0190b000-0000-7000-8000-000000000050', 'entity_access_requested', 'aaaaaaaa-0000-0000-0000-000000000001', 'harness', 'test', '2024-06-01 10:50:00', '{}', 'macro|user-2@example.com'),
       ('0190b000-0000-7000-8000-000000000051', 'entity_access_granted', 'aaaaaaaa-0000-0000-0000-000000000002', 'harness', 'test', '2024-06-01 10:51:00', '{}', 'macro|user-2@example.com'),
       ('0190b000-0000-7000-8000-000000000052', 'entity_access_requested', 'aaaaaaaa-0000-0000-0000-000000000003', 'harness', 'test', '2024-06-01 10:52:00', '{}', 'macro|user-3@example.com'),
       ('0190b000-0000-7000-8000-000000000053', 'entity_access_requested', 'aaaaaaaa-0000-0000-0000-000000000004', 'harness', 'test', '2024-06-01 10:53:00', '{}', 'macro|user-2@example.com');

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "state", "is_important_v0")
VALUES ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000050', '2024-06-01 10:50:00', FALSE, NULL, NULL, 'unseen', FALSE),
       ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000051', '2024-06-01 10:51:00', FALSE, NULL, NULL, 'unseen', FALSE),
       ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000052', '2024-06-01 10:52:00', FALSE, NULL, NULL, 'unseen', FALSE),
       ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000053', '2024-06-01 10:53:00', FALSE, NULL, NULL, 'unseen', FALSE);

SET session_replication_role = 'origin';
