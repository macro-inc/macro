-- Team-scoped notifications for the attention candidate query.
-- Loads after `work_feed`, which creates user-1 and user-2.
-- (times on 2024-06-01, UTC)
--
--   11:00  a vault access request on user-1's team-1           -> listed
--   11:01  a vault access request on team-2, which user-1 left -> not listed
--   11:02  a team invite, filed under an invite id (no team)   -> not listed
--   user-2 is in team-2, but no notification of team-2 is theirs -> not listed for user-2

SET session_replication_role = 'replica';

INSERT INTO public.team ("id", "name", "owner_id")
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Team 1', 'macro|user-1@example.com'),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'Team 2', 'macro|user-2@example.com');

INSERT INTO public.team_user ("user_id", "team_id", "team_role")
VALUES ('macro|user-1@example.com', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner'),
       ('macro|user-2@example.com', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner');

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id")
VALUES ('0190b000-0000-7000-8000-000000000060', 'password_access_requested', 'bbbbbbbb-0000-0000-0000-000000000001', 'team', 'test', '2024-06-01 11:00:00', '{}', 'macro|user-2@example.com'),
       ('0190b000-0000-7000-8000-000000000061', 'password_access_requested', 'bbbbbbbb-0000-0000-0000-000000000002', 'team', 'test', '2024-06-01 11:01:00', '{}', 'macro|user-2@example.com'),
       ('0190b000-0000-7000-8000-000000000062', 'invite_to_team', 'bbbbbbbb-0000-0000-0000-0000000000ff', 'team', 'test', '2024-06-01 11:02:00', '{}', 'macro|user-2@example.com');

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "state", "is_important_v0")
VALUES ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000060', '2024-06-01 11:00:00', FALSE, NULL, NULL, 'unseen', FALSE),
       ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000061', '2024-06-01 11:01:00', FALSE, NULL, NULL, 'unseen', FALSE),
       ('macro|user-1@example.com', '0190b000-0000-7000-8000-000000000062', '2024-06-01 11:02:00', FALSE, NULL, NULL, 'unseen', FALSE);

SET session_replication_role = 'origin';
