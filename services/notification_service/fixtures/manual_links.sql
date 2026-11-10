-- One entity of every kind a manual notification can link to, all owned by
-- user-1, plus an unlisted and a hidden agent session.
--
--   doc       11111111-…  document
--   chat      22222222-…  chat
--   channel   33333333-…  channel user-1 is a member of
--   project   66666666-…  project
--   thread    44444444-…  Signal email thread in user-1's own inbox
--   sessions  77777777-…  listed (…01), unlisted (…02), hidden (…03)

SET session_replication_role = 'replica';

INSERT INTO public."Organization" ("id", "name", "status")
VALUES (1, 'Test Organization', 'PILOT')
ON CONFLICT DO NOTHING;

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user@example.com', 'user@example.com', 'stripe_id_1');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
VALUES ('macro|user-1@example.com', 'user@example.com', 'stripe_id_1', 1, 'a1111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public."DocumentFamily" ("id", "rootDocumentId")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public."Document" ("id", "name", "owner", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Release notes', 'macro|user-1@example.com', 1, 'md', '2024-06-01 10:00:00', '2024-06-01 10:00:00', NULL);

INSERT INTO public."DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
VALUES (1, '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sha-1', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public."Chat" ("id", "name", "userId", "projectId", "createdAt", "updatedAt")
VALUES ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Planning chat', 'macro|user-1@example.com', NULL, '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.comms_channels ("id", "channel_type", "owner_id", "created_at", "updated_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'private', 'macro|user-1@example.com', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.comms_channel_participants ("channel_id", "role", "user_id", "joined_at", "left_at")
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'macro|user-1@example.com', '2024-06-01 10:00:00', NULL);

INSERT INTO public."Project" ("id", "name", "userId", "parentId", "createdAt", "updatedAt")
VALUES ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Launch', 'macro|user-1@example.com', NULL, '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.email_links ("id", "macro_id", "fusionauth_user_id", "email_address", "provider")
VALUES ('55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'macro|user-1@example.com', 'fa-user-1', 'user@example.com', 'GMAIL');

INSERT INTO public.email_threads ("id", "link_id", "inbox_visible", "is_signal", "latest_inbound_message_ts", "created_at", "updated_at")
VALUES ('44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE, TRUE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.email_contacts ("id", "link_id", "email_address", "name", "created_at", "updated_at")
VALUES ('c0000001-0000-0000-0000-000000000001', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sender@example.org', 'Sender', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.email_messages ("id", "provider_id", "thread_id", "link_id", "from_contact_id", "internal_date_ts", "snippet", "subject", "is_read", "is_sent", "is_draft", "has_attachments", "created_at", "updated_at")
VALUES ('ee000001-0000-0000-0000-000000000001', 'provider-msg-1', '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000001-0000-0000-0000-000000000001', '2024-06-01 10:00:00+00', 'Quarterly numbers', 'Quarterly numbers', FALSE, FALSE, FALSE, FALSE, '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00');

INSERT INTO public.agent_session (
    "id", "owner_id", "bot_id", "model", "harness", "repo_url", "workspace", "name",
    "status", "status_event_name", "created_at", "modified_at", "visibility", "list_hidden", "for_warming"
)
VALUES ('77777777-0000-0000-0000-000000000001', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Listed run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'listed', FALSE, FALSE),
       ('77777777-0000-0000-0000-000000000002', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Unlisted run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'unlisted', FALSE, FALSE),
       ('77777777-0000-0000-0000-000000000003', 'macro|user-1@example.com', 'b0000000-0000-0000-0000-000000000001', 'model', 'harness', NULL, '/workspace', 'Hidden run', 'event', 'session/end', '2024-06-01 10:00:00+00', '2024-06-01 10:00:00+00', 'hidden', TRUE, FALSE);

INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level", "granted_from_project_id")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'project', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('77777777-0000-0000-0000-000000000001', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('77777777-0000-0000-0000-000000000002', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL),
       ('77777777-0000-0000-0000-000000000003', 'agent_session', 'macro|user-1@example.com', 'user', 'owner', NULL);

SET session_replication_role = 'origin';
