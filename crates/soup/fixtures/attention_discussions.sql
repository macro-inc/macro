-- Project and CRM discussions for the attention candidate query.
-- Loads after `work_feed`, which creates user-1 and user-2.
-- (T = minute past 10:00 on 2024-06-01, UTC)
--
--   T40  discussion on company-1 (user-1's CRM team)        -> listed
--   T41  discussion on company-2 (same team, hidden)         -> not listed
--   T42  discussion on company-3 (another team)              -> not listed
--   T43  discussion on contact-1 (company-1)                 -> listed
--   T44  discussion on contact-2 (company-1, hidden contact) -> not listed
--   T45  discussion on project-1 (shared with user-1)        -> listed

SET session_replication_role = 'replica';

INSERT INTO public.team ("id", "name", "owner_id")
VALUES ('77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Team 1', 'macro|user-1@test.com'),
       ('77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Team 2', 'macro|user-2@test.com');

INSERT INTO public.team_user ("user_id", "team_id", "team_role")
VALUES ('macro|user-1@test.com', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
       ('macro|user-2@test.com', '77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner');

INSERT INTO public.team_crm_settings ("team_id", "crm_enabled")
VALUES ('77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE),
       ('77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE);

INSERT INTO public.crm_companies ("id", "team_id", "hidden", "first_interaction", "last_interaction", "custom_name")
VALUES ('88888888-0000-0000-0000-000000000001', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', 'Company 1'),
       ('88888888-0000-0000-0000-000000000002', '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', 'Company 2'),
       ('88888888-0000-0000-0000-000000000003', '77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb', FALSE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00', 'Company 3');

INSERT INTO public.crm_contacts ("id", "company_id", "email", "hidden", "first_interaction", "last_interaction")
VALUES ('88888888-1111-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'contact1@company1.test', FALSE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00'),
       ('88888888-1111-0000-0000-000000000002', '88888888-0000-0000-0000-000000000001', 'contact2@company1.test', TRUE, '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00');

INSERT INTO public.initiative ("id", "name", "owner_user_id", "share_permission_id")
VALUES ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Project 1', 'macro|user-2@test.com', 'sp-project-1');

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'initiative', 'macro|user-1@test.com', 'user', 'edit', NULL);

INSERT INTO public.notification ("id", "notification_event_type", "event_item_id", "event_item_type", "service_sender", "created_at", "metadata", "sender_id", "secondary_event_item_id", "secondary_event_item_type")
VALUES
('0190b000-0000-7000-8000-000000000040', 'crm_discussion', '88888888-0000-0000-0000-000000000001', 'crm_company', 'test', '2024-06-01 10:40:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000041', 'crm_discussion', '88888888-0000-0000-0000-000000000002', 'crm_company', 'test', '2024-06-01 10:41:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000042', 'crm_discussion', '88888888-0000-0000-0000-000000000003', 'crm_company', 'test', '2024-06-01 10:42:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000043', 'crm_discussion', '88888888-1111-0000-0000-000000000001', 'crm_contact', 'test', '2024-06-01 10:43:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000044', 'crm_discussion', '88888888-1111-0000-0000-000000000002', 'crm_contact', 'test', '2024-06-01 10:44:00', '{}', 'macro|user-2@test.com', NULL, NULL),
('0190b000-0000-7000-8000-000000000045', 'initiative_discussion', '66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'initiative', 'test', '2024-06-01 10:45:00', '{}', 'macro|user-2@test.com', NULL, NULL);

INSERT INTO public.user_notification ("user_id", "notification_id", "created_at", "sent", "seen_at", "deleted_at", "state", "is_important_v0")
VALUES
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000040', '2024-06-01 10:40:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000041', '2024-06-01 10:41:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000042', '2024-06-01 10:42:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000043', '2024-06-01 10:43:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000044', '2024-06-01 10:44:00', TRUE, NULL, NULL, 'unseen', FALSE),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000045', '2024-06-01 10:45:00', TRUE, NULL, NULL, 'unseen', FALSE);

SET session_replication_role = 'origin';
