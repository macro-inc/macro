-- Fixture for testing document access inherited from email thread permissions.
-- Sets up documents that are email attachments linked to threads, with various
-- thread permission configurations.

TRUNCATE TABLE public."User", public."Project", public."Document", public."SharePermission",
    public."DocumentPermission", public."ProjectPermission", public."EmailThreadPermission",
    public.entity_access, public.email_links, public.email_threads, public.email_messages,
    public.email_attachments, public.document_email RESTART IDENTITY CASCADE;

------------------------------------------------------------
-- Users
------------------------------------------------------------
INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('a1111111-1111-1111-1111-111111111111', 'user_thread', 'user_thread@test.com', 'stripe_user_thread'),
       ('a2222222-2222-2222-2222-222222222222', 'user_none', 'user_none@test.com', 'stripe_user_none'),
       ('a3333333-3333-3333-3333-333333333333', 'user_both', 'user_both@test.com', 'stripe_user_both');
INSERT INTO public."User" ("id", "email", "macro_user_id")
VALUES ('user-thread-access', 'user_thread@test.com', 'a1111111-1111-1111-1111-111111111111'),   -- Has thread access only
       ('user-no-access', 'user_none@test.com', 'a2222222-2222-2222-2222-222222222222'),          -- Has no access at all
       ('user-both-access', 'user_both@test.com', 'a3333333-3333-3333-3333-333333333333');         -- Has both direct doc and thread access

------------------------------------------------------------
-- Email infrastructure: link, thread, message, attachment
------------------------------------------------------------
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('a0000000-0000-0000-0000-000000000001', 'macro|owner@test.com', 'a0000000-0000-0000-0000-000000000001',
        'owner@test.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', false, false, NOW(), NOW()),
       ('a0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', false, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('a0000000-0000-0000-0000-000000000100', 'a0000000-0000-0000-0000-000000000010',
        'a0000000-0000-0000-0000-000000000001', 'provider-msg-1', false, NOW(), true, false, false, false, NOW(), NOW()),
       ('a0000000-0000-0000-0000-000000000200', 'a0000000-0000-0000-0000-000000000020',
        'a0000000-0000-0000-0000-000000000001', 'provider-msg-2', false, NOW(), true, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('a0000000-0000-0000-0000-000000001000', 'a0000000-0000-0000-0000-000000000100', 'prov-att-1', 'report.pdf', 'application/pdf', NOW()),
       ('a0000000-0000-0000-0000-000000002000', 'a0000000-0000-0000-0000-000000000200', 'prov-att-2', 'invoice.pdf', 'application/pdf', NOW());

------------------------------------------------------------
-- Documents (email attachments uploaded as documents)
------------------------------------------------------------
-- d-attachment: linked to thread 1 via email attachment, no direct permissions
-- d-attachment-with-direct: linked to thread 2 via email attachment, also has direct access
-- d-not-attachment: regular document, not linked to any email
INSERT INTO public."Document" ("id", "name", "owner")
VALUES ('dddddddd-dddd-dddd-dddd-100000000001', 'Email Attachment Doc', 'user-thread-access'),
       ('dddddddd-dddd-dddd-dddd-100000000002', 'Email Attachment With Direct Access', 'user-both-access'),
       ('dddddddd-dddd-dddd-dddd-100000000003', 'Regular Document', 'user-no-access');

-- Link documents to email attachments
INSERT INTO document_email (document_id, email_attachment_id)
VALUES ('dddddddd-dddd-dddd-dddd-100000000001', 'a0000000-0000-0000-0000-000000001000'),
       ('dddddddd-dddd-dddd-dddd-100000000002', 'a0000000-0000-0000-0000-000000002000');

------------------------------------------------------------
-- Thread permissions (via EmailThreadPermission + SharePermission)
------------------------------------------------------------
INSERT INTO public."SharePermission" ("id", "isPublic", "publicAccessLevel")
VALUES ('sp-thread-1', false, NULL),
       ('sp-thread-2', false, NULL);

INSERT INTO public."EmailThreadPermission" ("threadId", "sharePermissionId", "userId")
VALUES ('a0000000-0000-0000-0000-000000000010', 'sp-thread-1', 'user-thread-access'),
       ('a0000000-0000-0000-0000-000000000020', 'sp-thread-2', 'user-both-access');

-- user-thread-access has view on thread 1 (so should get view on d-attachment)
-- user-both-access has edit on thread 2
INSERT INTO public.entity_access ("entity_id", "entity_type", "source_id", "source_type", "access_level")
VALUES
    ('a0000000-0000-0000-0000-000000000010', 'thread', 'user-thread-access', 'user', 'view'),
    ('a0000000-0000-0000-0000-000000000020', 'thread', 'user-both-access', 'user', 'edit'),
    -- user-both-access also has direct view on d-attachment-with-direct (thread gives edit, so edit should win)
    ('dddddddd-dddd-dddd-dddd-100000000002', 'document', 'user-both-access', 'user', 'view');
