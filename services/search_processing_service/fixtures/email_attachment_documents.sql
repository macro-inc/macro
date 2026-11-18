-- Documents imported from email attachments, in `document_id` order:
--   attachment-a  live, linked to two attachments
--   attachment-b  live, linked once
--   attachment-c  trashed, linked once
--   attachment-e  live, linked once
--   plain-d       live, linked to nothing

INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
VALUES ('c3333333-3333-3333-3333-333333333333', 'owner@example.com', 'owner@example.com', 'stripe_id');

INSERT INTO public."User" ("id", "email", "stripeCustomerId", "macro_user_id")
VALUES ('macro|owner@example.com', 'owner@example.com', 'stripe_id', 'c3333333-3333-3333-3333-333333333333');

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c001', 'macro|owner@example.com', '00000000-0000-0000-0000-00000000c001',
        'owner@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c001', 'sender@example.com', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000c001', true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c003',
        '00000000-0000-0000-0000-00000000c001', 'provider-msg-c004', false,
        '00000000-0000-0000-0000-00000000c002', '2025-01-05 10:00:00 +00:00', true, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c004', 'att-a1', 'a.html', 'text/html', NOW()),
       ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000c004', 'att-a2', 'a.html', 'text/html', NOW()),
       ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000c004', 'att-b', 'b.pdf', 'application/pdf', NOW()),
       ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-00000000c004', 'att-c', 'c.pdf', 'application/pdf', NOW()),
       ('00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-00000000c004', 'att-e', 'e.pdf', 'application/pdf', NOW());

INSERT INTO public."Document" ("id", "name", "fileType", "owner", "deletedAt")
VALUES ('attachment-a', 'forwarded page', 'html', 'macro|owner@example.com', NULL),
       ('attachment-b', 'invoice', 'pdf', 'macro|owner@example.com', NULL),
       ('attachment-c', 'trashed invoice', 'pdf', 'macro|owner@example.com', NOW()),
       ('attachment-e', 'receipt', 'pdf', 'macro|owner@example.com', NULL),
       ('plain-d', 'own page', 'html', 'macro|owner@example.com', NULL);

INSERT INTO public."DocumentInstance" ("revisionName", "documentId", "sha", "createdAt", "updatedAt")
VALUES ('forwarded page', 'attachment-a', 'sha-a', '2019-10-16 00:00:00', '2019-10-16 00:00:00'),
       ('own page', 'plain-d', 'sha-d', '2019-10-16 00:00:00', '2019-10-16 00:00:00');

INSERT INTO document_email (document_id, email_attachment_id)
VALUES ('attachment-a', '00000000-0000-0000-0000-00000000a001'),
       ('attachment-a', '00000000-0000-0000-0000-00000000a002'),
       ('attachment-b', '00000000-0000-0000-0000-00000000a003'),
       ('attachment-c', '00000000-0000-0000-0000-00000000a004'),
       ('attachment-e', '00000000-0000-0000-0000-00000000a005');
