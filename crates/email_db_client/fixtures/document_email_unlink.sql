-- Last-link document_email teardown cases.
--
-- D1 is linked only to A1 on M1/L1. Deleting A1, M1, or L1 flips it.
-- D2 is linked to A2 (M1/L1) and A3 (M2/L1). Deleting M1 keeps it; deleting L1 flips it.
-- D3 is linked to A1 (L1) and A4 (M3/L2). Deleting L1 keeps it; deleting both links flips it.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000d01', 'macro|unlink_user@example.com', '00000000-0000-0000-0000-000000000d01',
        'unlink_user@example.com', 'GMAIL', true, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000000d02', 'macro|unlink_user@example.com', '00000000-0000-0000-0000-000000000d02',
        'unlink_other@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cd001',
        '00000000-0000-0000-0000-000000000d01',
        'sender@example.com',
        NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000cd002',
        '00000000-0000-0000-0000-000000000d02',
        'sender@example.com',
        NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        true, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d202',
        '00000000-0000-0000-0000-000000000d02',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d501',
        '00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d501', 'gid-d501', FALSE,
        '00000000-0000-0000-0000-0000000cd001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d502',
        '00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        'provider-msg-d502', 'gid-d502', FALSE,
        '00000000-0000-0000-0000-0000000cd001',
        '2025-01-06 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000d503',
        '00000000-0000-0000-0000-00000000d202',
        '00000000-0000-0000-0000-000000000d02',
        'provider-msg-d503', 'gid-d503', FALSE,
        '00000000-0000-0000-0000-0000000cd002',
        '2025-01-07 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001da001',
        '00000000-0000-0000-0000-00000000d501',
        'provider-att-d001', 'only-on-d1.pdf', 'application/pdf', 1024, NULL, NOW()),
       ('00000000-0000-0000-0000-0000001da002',
        '00000000-0000-0000-0000-00000000d501',
        'provider-att-d002', 'shared-d2-a.pdf', 'application/pdf', 2048, NULL, NOW()),
       ('00000000-0000-0000-0000-0000001da003',
        '00000000-0000-0000-0000-00000000d502',
        'provider-att-d003', 'shared-d2-b.pdf', 'application/pdf', 3072, NULL, NOW()),
       ('00000000-0000-0000-0000-0000001da004',
        '00000000-0000-0000-0000-00000000d503',
        'provider-att-d004', 'other-link.pdf', 'application/pdf', 4096, NULL, NOW());

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('00000000-0000-0000-0000-000000000d11',
        'unlink_user',
        'unlink_user@example.com',
        'cus_unlink');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('00000000-0000-0000-0000-000000000d11',
        'unlink_user@example.com',
        'Unlink User',
        '00000000-0000-0000-0000-000000000d11');

INSERT INTO "Document" (id, name, owner, "fileType", uploaded, "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-00000000dd01',
        'only-a1.pdf',
        '00000000-0000-0000-0000-000000000d11',
        'application/pdf',
        true,
        NOW(),
        NOW()),
       ('00000000-0000-0000-0000-00000000dd02',
        'shared-l1.pdf',
        '00000000-0000-0000-0000-000000000d11',
        'application/pdf',
        true,
        NOW(),
        NOW()),
       ('00000000-0000-0000-0000-00000000dd03',
        'shared-across-links.pdf',
        '00000000-0000-0000-0000-000000000d11',
        'application/pdf',
        true,
        NOW(),
        NOW());

INSERT INTO document_email (document_id, email_attachment_id)
VALUES ('00000000-0000-0000-0000-00000000dd01',
        '00000000-0000-0000-0000-0000001da001'),
       ('00000000-0000-0000-0000-00000000dd02',
        '00000000-0000-0000-0000-0000001da002'),
       ('00000000-0000-0000-0000-00000000dd02',
        '00000000-0000-0000-0000-0000001da003'),
       ('00000000-0000-0000-0000-00000000dd03',
        '00000000-0000-0000-0000-0000001da001'),
       ('00000000-0000-0000-0000-00000000dd03',
        '00000000-0000-0000-0000-0000001da004');
