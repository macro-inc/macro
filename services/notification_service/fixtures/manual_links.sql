-- Entities a manual notification can link to, and who can see them.
--
-- user-1 sends. user-2 is a teammate with access to one entity of every
-- linkable kind. user-3 reaches one document only through its public link.
--
--   doc       11111111-…-aaaa  user-1 owns, user-2 views
--   chat      22222222-…-aaaa  user-1 owns, user-2 views
--   channel   33333333-…-aaaa  user-1 and user-2 are members
--   project   66666666-…-aaaa  user-1 owns, user-2 views
--   mail      44444444-…-0001  user-1's own Signal inbox thread
--             44444444-…-0002  user-2's own Signal inbox thread, shared with user-1
--             44444444-…-0003  user-1's own thread, not Signal
--   sessions  77777777-…-0001  listed, user-1 owns, user-2 views
--             77777777-…-0002  unlisted, 77777777-…-0003 hidden (user-1 only)
--   refused   11111111-…-bbbb  user-1 owns; public link share only for user-3
--             11111111-…-cccc  user-1 owns, in the trash
--             11111111-…-dddd  user-1 owns, a snippet
--   late      11111111-…-eeee  user-1 owns; the test shares it with user-3

SET session_replication_role = 'replica';

INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user1@example.com', 'user1@example.com', 'stripe_id_1'),
       ('a2222222-2222-2222-2222-222222222222', 'user2@example.com', 'user2@example.com', 'stripe_id_2'),
       ('a3333333-3333-3333-3333-333333333333', 'user3@example.com', 'user3@example.com', 'stripe_id_3');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@example.com', 'user1@example.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111'),
       ('macro|user-2@example.com', 'user2@example.com', 'stripe_id_2', 1, 'a2222222-2222-2222-2222-222222222222'),
       ('macro|user-3@example.com', 'user3@example.com', 'stripe_id_3', 1, 'a3333333-3333-3333-3333-333333333333')
ON CONFLICT DO NOTHING;

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
       (3, '11111111-cccc-cccc-cccc-cccccccccccc'),
       (4, '11111111-dddd-dddd-dddd-dddddddddddd'),
       (5, '11111111-eeee-eeee-eeee-eeeeeeeeeeee');

INSERT INTO public."Document" ("id", "name", "owner", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Release notes', 'macro|user-1@example.com', 1, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Public page', 'macro|user-1@example.com', 2, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', NULL),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'Old draft', 'macro|user-1@example.com', 3, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', '2024-06-02 10:00:00'),
       ('11111111-dddd-dddd-dddd-dddddddddddd', 'Snippet', 'macro|user-1@example.com', 4, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', NULL),
       ('11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'Shared just now', 'macro|user-1@example.com', 5, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', NULL);

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-1', '2024-06-01 10:00:00', '2024-06-01 10:00:00'),
       (2, '11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sha-2', '2024-06-01 10:00:00', '2024-06-01 10:00:00'),
       (3, '11111111-cccc-cccc-cccc-cccccccccccc', 'sha-3', '2024-06-01 10:00:00', '2024-06-01 10:00:00'),
       (4, '11111111-dddd-dddd-dddd-dddddddddddd', 'sha-4', '2024-06-01 10:00:00', '2024-06-01 10:00:00'),
       (5, '11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'sha-5', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.document_sub_type (document_id, sub_type)
VALUES ('11111111-dddd-dddd-dddd-dddddddddddd', 'snippet');

INSERT INTO public."SharePermission" ("id", "linkShare", "linkShareAccessLevel", "createdAt", "updatedAt")
VALUES ('sp-public-page', 'PUBLIC', 'view', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public."DocumentPermission" ("documentId", "sharePermissionId")
VALUES ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'sp-public-page');

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Planning chat', 'macro|user-1@example.com', NULL, '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'private', 'macro|user-1@example.com', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'macro|user-1@example.com', '2024-06-01 10:00:00', NULL),
       ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member', 'macro|user-2@example.com', '2024-06-01 10:00:00', NULL);

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Launch', 'macro|user-1@example.com', NULL, '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.email_links ("id", "macro_id", "fusionauth_user_id", "email_address", "provider")
VALUES ('55555555-0000-0000-0000-000000000001', 'macro|user-1@example.com', 'fa-user-1', 'user1@example.com', 'GMAIL'),
       ('55555555-0000-0000-0000-000000000002', 'macro|user-2@example.com', 'fa-user-2', 'user2@example.com', 'GMAIL');

INSERT INTO public.email_threads ("id", "link_id", "inbox_visible", "is_signal", "latest_inbound_message_ts", "created_at", "updated_at")
VALUES ('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', TRUE, TRUE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00'),
       ('44444444-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', TRUE, TRUE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00'),
       ('44444444-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', TRUE, FALSE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.email_contacts ("id", "link_id", "email_address", "name", "created_at", "updated_at")
VALUES ('c0000001-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'sender@example.org', 'Sender', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00'),
       ('c0000001-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', 'sender@example.org', 'Sender', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.email_messages ("id", "provider_id", "thread_id", "link_id", "from_contact_id", "internal_date_ts", "snippet", "subject", "is_read", "is_sent", "is_draft", "has_attachments", "created_at", "updated_at")
VALUES ('ee000001-0000-0000-0000-000000000001', 'provider-msg-1', '44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', '2024-06-01 10:00:00+00', 'Quarterly numbers', 'Quarterly numbers', FALSE, FALSE, FALSE, FALSE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00'),
       ('ee000001-0000-0000-0000-000000000002', 'provider-msg-2', '44444444-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', 'c0000001-0000-0000-0000-000000000002', '2024-06-01 10:00:00+00', 'Contract', 'Contract', FALSE, FALSE, FALSE, FALSE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00'),
       ('ee000001-0000-0000-0000-000000000003', 'provider-msg-3', '44444444-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', '2024-06-01 10:00:00+00', 'Newsletter', 'Newsletter', FALSE, FALSE, FALSE, FALSE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.agent_session (
    "id", "owner_id", "bot_id", "model", "harness", "repo_url", "workspace", "name",
    "status", "status_event_name", "created_at", "modified_at", "visibility", "list_hidden", "for_warming"
)
VALUES ('77777777-0000-0000-0000-000000000001', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Listed run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'listed', FALSE, FALSE),
       ('77777777-0000-0000-0000-000000000002', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Unlisted run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'unlisted', FALSE, FALSE),
       ('77777777-0000-0000-0000-000000000003', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Hidden run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'hidden', TRUE, FALSE);

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-2@example.com', 'user', 'view', NULL),
       ('11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('11111111-cccc-cccc-cccc-cccccccccccc', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('11111111-dddd-dddd-dddd-dddddddddddd', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('11111111-eeee-eeee-eeee-eeeeeeeeeeee', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-2@example.com', 'user', 'view', NULL),
       ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'macro|user-2@example.com', 'user', 'view', NULL),
       ('44444444-0000-0000-0000-000000000002', 'email_thread', 'macro|user-1@example.com', 'user', 'view', NULL),
       ('77777777-0000-0000-0000-000000000001', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('77777777-0000-0000-0000-000000000001', 'agent_session', 'macro|user-2@example.com', 'user', 'view', NULL),
       ('77777777-0000-0000-0000-000000000002', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('77777777-0000-0000-0000-000000000003', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL);

SET session_replication_role = 'origin';
