
-- SQL fixture for fetch_db_attachments tests
-- Tests fetching attachments with and without SFS mappings, ordered by filename (NULLS LAST)

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001b', 'macro|user_b@example.com', '00000000-0000-0000-0000-00000000001b',
        'user_b@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0010',
        '00000000-0000-0000-0000-00000000001b',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-00000000001b',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Multiple attachments with and without SFS
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0501',
        '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-00000000001b',
        'provider-msg-501',
        FALSE,
        '00000000-0000-0000-0000-0000000c0010',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Attachment 1: With SFS mapping, filename starts with 'a'
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0501',
        '00000000-0000-0000-0000-0000000e0501',
        'provider-att-501',
        'alpha_document.pdf',
        'application/pdf',
        102400,
        NULL,
        NOW());

INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id, created_at)
VALUES ('00000000-0000-0000-0000-000000005501',
        '00000000-0000-0000-0000-0000001a0501',
        '00000000-0000-0000-0000-000000f10001',
        NOW());

-- Attachment 2: Without SFS mapping, filename starts with 'z'
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0502',
        '00000000-0000-0000-0000-0000000e0501',
        'provider-att-502',
        'zulu_spreadsheet.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        204800,
        'content-id-502',
        NOW());

-- Attachment 3: With SFS mapping, filename starts with 'b'
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0503',
        '00000000-0000-0000-0000-0000000e0501',
        'provider-att-503',
        'bravo_image.jpg',
        'image/jpeg',
        512000,
        'content-id-503',
        NOW());

INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id, created_at)
VALUES ('00000000-0000-0000-0000-000000005503',
        '00000000-0000-0000-0000-0000001a0503',
        '00000000-0000-0000-0000-000000f10003',
        NOW());

-- Attachment 4: No filename (NULL), should be ordered last
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0504',
        '00000000-0000-0000-0000-0000000e0501',
        'provider-att-504',
        NULL,
        'application/octet-stream',
        1024,
        NULL,
        NOW());