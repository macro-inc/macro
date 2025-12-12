-- SQL fixture for new_email_media_atts tests
-- This fixture tests that media attachments are fetched for new emails
-- and that already uploaded attachments (in email_attachments_sfs) are excluded

-- User Link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000003a', 'macro|new_media_user@example.com', '00000000-0000-0000-0000-00000000003a',
        'new_media_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Contact
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c3001',
        '00000000-0000-0000-0000-00000000003a',
        'sender@example.com',
        NOW(), NOW());

-- Threads
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000003a',
        false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-00000000003a',
        false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000003a',
        false, false, NOW(), NOW());

------------------------------------------------------------
-- Thread 1: New email with media attachments (not yet uploaded)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e3001',
        '00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000003a',
        'new-media-msg-301',
        FALSE,
        '00000000-0000-0000-0000-0000000c3001',
        '2025-01-01 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Image attachment (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3001',
        '00000000-0000-0000-0000-0000000e3001',
        'provider-att-3001',
        'new_photo.jpg',
        'image/jpeg',
        NULL,
        NOW());

-- Video attachment (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3002',
        '00000000-0000-0000-0000-0000000e3001',
        'provider-att-3002',
        'new_video.mp4',
        'video/mp4',
        NULL,
        NOW());

------------------------------------------------------------
-- Thread 2: Email with media already uploaded to SFS
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e3002',
        '00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-00000000003a',
        'new-media-msg-302',
        FALSE,
        '00000000-0000-0000-0000-0000000c3001',
        '2025-01-01 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Image already in SFS (should NOT be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3003',
        '00000000-0000-0000-0000-0000000e3002',
        'provider-att-3003',
        'existing_photo.jpg',
        'image/jpeg',
        NULL,
        NOW());

-- Simulate that this attachment is already in SFS
INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3003',
'00000000-0000-0000-0000-0000003a3003',
        '00000000-0000-aaaa-0000-0000003a3003',
        NOW());

------------------------------------------------------------
-- Thread 3: Email with inline images 
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e3003',
        '00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000003a',
        'new-media-msg-303',
        FALSE,
        '00000000-0000-0000-0000-0000000c3001',
        '2025-01-01 12:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Inline image (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3004',
        '00000000-0000-0000-0000-0000000e3003',
        'provider-att-3004',
        'inline_image.png',
        'image/png',
        'inline-123',
        NOW());

-- Non-inline image (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000003a3005',
        '00000000-0000-0000-0000-0000000e3003',
        'provider-att-3005',
        'attachment_image.png',
        'image/png',
        NULL,
        NOW());