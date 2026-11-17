-- SQL fixture for get_document_by_att_id tests
-- One attachment per document state the attachment opener distinguishes.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b001', 'macro|user@example.com', '00000000-0000-0000-0000-00000000b001',
        'user@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b002',
        '00000000-0000-0000-0000-00000000b001',
        'sender@example.com',
        NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b003',
        '00000000-0000-0000-0000-00000000b001',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b004',
        '00000000-0000-0000-0000-00000000b003',
        '00000000-0000-0000-0000-00000000b001',
        'provider-msg-b004',
        FALSE,
        '00000000-0000-0000-0000-00000000b002',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b004', 'att-pending', 'pending.pdf', 'application/pdf', NOW()),
       ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000b004', 'att-uploaded', 'uploaded.pdf', 'application/pdf', NOW()),
       ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000b004', 'att-docx', 'converting.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NOW()),
       ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-00000000b004', 'att-deleted', 'deleted.pdf', 'application/pdf', NOW()),
       ('00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-00000000b004', 'att-unlinked', 'unlinked.pdf', 'application/pdf', NOW());

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('00000000-0000-0000-0000-00000000b001',
        'user',
        'user@example.com',
        'cus_test123');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('00000000-0000-0000-0000-00000000b001',
        'user@example.com',
        'User',
        '00000000-0000-0000-0000-00000000b001');

INSERT INTO "Document" (id, name, owner, "fileType", uploaded, "deletedAt", "createdAt", "updatedAt")
VALUES ('doc-pending', 'pending', '00000000-0000-0000-0000-00000000b001', 'pdf', false, NULL, NOW(), NOW()),
       ('doc-uploaded', 'uploaded', '00000000-0000-0000-0000-00000000b001', 'pdf', true, NULL, NOW(), NOW()),
       ('doc-docx', 'converting', '00000000-0000-0000-0000-00000000b001', 'docx', false, NULL, NOW(), NOW()),
       ('doc-deleted', 'deleted', '00000000-0000-0000-0000-00000000b001', 'pdf', false, NOW(), NOW(), NOW());

INSERT INTO document_email (document_id, email_attachment_id)
VALUES ('doc-pending', '00000000-0000-0000-0000-00000000a001'),
       ('doc-uploaded', '00000000-0000-0000-0000-00000000a002'),
       ('doc-docx', '00000000-0000-0000-0000-00000000a003'),
       ('doc-deleted', '00000000-0000-0000-0000-00000000a004');
