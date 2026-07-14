-- SQL fixture for fetch_db_attachments_in_bulk tests
-- Tests fetching provider attachments for multiple message IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000a01', 'macro|bulk_att_user@example.com', '00000000-0000-0000-0000-000000000a01',
        'bulk_att_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ca001',
        '00000000-0000-0000-0000-000000000a01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000a201',
        '00000000-0000-0000-0000-000000000a01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Has multiple attachments with and without SFS
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000a501',
        '00000000-0000-0000-0000-00000000a201',
        '00000000-0000-0000-0000-000000000a01',
        'provider-msg-a501',
        FALSE,
        '00000000-0000-0000-0000-0000000ca001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Message 1 Attachment 1: alpha_document.pdf with SFS mapping
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa001',
        '00000000-0000-0000-0000-00000000a501',
        'provider-att-a001',
        'alpha_document.pdf',
        'application/pdf',
        102400,
        NULL,
        NOW());

INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id, created_at)
VALUES ('00000000-0000-0000-0000-000000005a01',
        '00000000-0000-0000-0000-0000001aa001',
        '00000000-0000-0000-0000-000000f1a001',
        NOW());

-- Message 1 Attachment 2: bravo_image.jpg without SFS mapping
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa002',
        '00000000-0000-0000-0000-00000000a501',
        'provider-att-a002',
        'bravo_image.jpg',
        'image/jpeg',
        512000,
        'content-id-a002',
        NOW());

-- Message 1 Attachment 3: zulu_spreadsheet.xlsx without SFS mapping
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa003',
        '00000000-0000-0000-0000-00000000a501',
        'provider-att-a003',
        'zulu_spreadsheet.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        204800,
        NULL,
        NOW());

------------------------------------------------------------
-- Message 2: Has one attachment
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000a502',
        '00000000-0000-0000-0000-00000000a201',
        '00000000-0000-0000-0000-000000000a01',
        'provider-msg-a502',
        FALSE,
        '00000000-0000-0000-0000-0000000ca001',
        '2025-01-05 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Message 2 Attachment 1: single_file.txt
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa004',
        '00000000-0000-0000-0000-00000000a502',
        'provider-att-a004',
        'single_file.txt',
        'text/plain',
        1024,
        NULL,
        NOW());

------------------------------------------------------------
-- Message 3: No attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000a503',
        '00000000-0000-0000-0000-00000000a201',
        '00000000-0000-0000-0000-000000000a01',
        'provider-msg-a503',
        FALSE,
        '00000000-0000-0000-0000-0000000ca001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

------------------------------------------------------------
-- Message 4: Attachment with NULL filename (for NULLS LAST ordering test)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000a504',
        '00000000-0000-0000-0000-00000000a201',
        '00000000-0000-0000-0000-000000000a01',
        'provider-msg-a504',
        FALSE,
        '00000000-0000-0000-0000-0000000ca001',
        '2025-01-05 13:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Message 4 Attachment 1: NULL filename
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa005',
        '00000000-0000-0000-0000-00000000a504',
        'provider-att-a005',
        NULL,
        'application/octet-stream',
        2048,
        NULL,
        NOW());

-- Message 4 Attachment 2: alpha_first.pdf (named alphabetically first)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001aa006',
        '00000000-0000-0000-0000-00000000a504',
        'provider-att-a006',
        'alpha_first.pdf',
        'application/pdf',
        4096,
        NULL,
        NOW());
