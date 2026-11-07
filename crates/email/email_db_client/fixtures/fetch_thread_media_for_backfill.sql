
-- SQL fixture for thread_media_atts_for_backfill tests
-- This fixture tests that media attachments (images, videos) are fetched
-- regardless of thread conditions

-- User Link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000002a', 'macro|media_user@example.com', '00000000-0000-0000-0000-00000000002a',
        'media_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Contact
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c2001',
        '00000000-0000-0000-0000-00000000002a',
        'sender@example.com',
        NOW(), NOW());

-- Thread 1: Contains media attachments
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-00000000002a',
        false, false, NOW(), NOW());

-- Thread 2: Contains inline images (should not be filtered out)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000202',
        '00000000-0000-0000-0000-00000000002a',
        false, false, NOW(), NOW());

-- Thread 3: Contains mixed media types
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000203',
        '00000000-0000-0000-0000-00000000002a',
        false, false, NOW(), NOW());

-- Thread 4: Empty thread
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000204',
        '00000000-0000-0000-0000-00000000002a',
        false, false, NOW(), NOW());

------------------------------------------------------------
-- Thread 1: Contains valid media attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e2001',
        '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-00000000002a',
        'media-msg-201',
        FALSE,
        '00000000-0000-0000-0000-0000000c2001',
        '2025-01-01 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Non-inline image (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2001',
        '00000000-0000-0000-0000-0000000e2001',
        'provider-att-2001',
        'photo.jpg',
        'image/jpeg',
        NULL, -- not inline
        NOW());

-- Video (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2002',
        '00000000-0000-0000-0000-0000000e2001',
        'provider-att-2002',
        'video.mp4',
        'video/mp4',
        NULL,
        NOW());

-- Document (should NOT be included - filtered by ATTACHMENT_MIME_TYPE_FILTERS_WITH_MEDIA)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2003',
        '00000000-0000-0000-0000-0000000e2001',
        'provider-att-2003',
        'document.pdf',
        'application/pdf',
        NULL,
        NOW());

------------------------------------------------------------
-- Thread 2: Contains inline images (should not be filtered out)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e2002',
        '00000000-0000-0000-0000-000000000202',
        '00000000-0000-0000-0000-00000000002a',
        'media-msg-202',
        FALSE,
        '00000000-0000-0000-0000-0000000c2001',
        '2025-01-01 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Inline image (should be included)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2004',
        '00000000-0000-0000-0000-0000000e2002',
        'provider-att-2004',
        'inline_image.png',
        'image/png',
        'inline-content-id-123', -- inline attachment
        NOW());

------------------------------------------------------------
-- Thread 3: Contains mixed media types
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e2003',
        '00000000-0000-0000-0000-000000000203',
        '00000000-0000-0000-0000-00000000002a',
        'media-msg-203',
        FALSE,
        '00000000-0000-0000-0000-0000000c2001',
        '2025-01-01 12:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- PNG image
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2005',
        '00000000-0000-0000-0000-0000000e2003',
        'provider-att-2005',
        'screenshot.png',
        'image/png',
        NULL,
        NOW());

-- GIF image
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2006',
        '00000000-0000-0000-0000-0000000e2003',
        'provider-att-2006',
        'animation.gif',
        'image/gif',
        NULL,
        NOW());

-- MOV video
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000002a2007',
        '00000000-0000-0000-0000-0000000e2003',
        'provider-att-2007',
        'clip.mov',
        'video/quicktime',
        NULL,
        NOW());

------------------------------------------------------------
-- Thread 4: Empty thread with message but no attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e2004',
        '00000000-0000-0000-0000-000000000204',
        '00000000-0000-0000-0000-00000000002a',
        'media-msg-204',
        FALSE,
        '00000000-0000-0000-0000-0000000c2001',
        '2025-01-01 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW());