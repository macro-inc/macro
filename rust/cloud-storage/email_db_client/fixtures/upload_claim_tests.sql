-- SQL fixture for upload claim tests
-- Tests that new_email_document_atts and new_email_media_atts atomically claim attachments

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000c01', 'macro|claim_test@example.com', '00000000-0000-0000-0000-000000000c01',
        'claim_test@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000c0c0001',
        '00000000-0000-0000-0000-000000000c01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread for document claim test
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c101',
        '00000000-0000-0000-0000-000000000c01',
        false, false, NOW(), NOW());

-- Message with document attachment (is_sent = true to meet condition 1)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ec101',
        '00000000-0000-0000-0000-00000000c101',
        '00000000-0000-0000-0000-000000000c01',
        'claim-test-doc-msg',
        TRUE,
        '00000000-0000-0000-0000-00000c0c0001',
        '2025-01-01 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Document attachment to be claimed
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000c1a0101',
        '00000000-0000-0000-0000-0000000ec101',
        'claim-test-doc-att',
        'claimable_doc.pdf',
        'application/pdf',
        NOW());

-- Second document attachment to test multiple claims
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000c1a0102',
        '00000000-0000-0000-0000-0000000ec101',
        'claim-test-doc-att-2',
        'claimable_doc_2.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread for media claim test
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        false, false, NOW(), NOW());

-- Message with media attachment
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ec201',
        '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        'claim-test-media-msg',
        FALSE,
        '00000000-0000-0000-0000-00000c0c0001',
        '2025-01-01 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Media attachment to be claimed
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000c2a0201',
        '00000000-0000-0000-0000-0000000ec201',
        'claim-test-media-att',
        'claimable_image.jpg',
        'image/jpeg',
        NOW());

-- Second media attachment
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000c2a0202',
        '00000000-0000-0000-0000-0000000ec201',
        'claim-test-media-att-2',
        'claimable_video.mp4',
        'video/mp4',
        NOW());

------------------------------------------------------------
-- Thread for pre-claimed attachment test
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c301',
        '00000000-0000-0000-0000-000000000c01',
        false, false, NOW(), NOW());

-- Message with pre-claimed attachment (is_sent = true to meet condition 1)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ec301',
        '00000000-0000-0000-0000-00000000c301',
        '00000000-0000-0000-0000-000000000c01',
        'claim-test-preclaimed-msg',
        TRUE,
        '00000000-0000-0000-0000-00000c0c0001',
        '2025-01-01 12:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Pre-claimed document attachment (already has upload_claimed_at set)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, upload_claimed_at, created_at)
VALUES ('00000000-0000-0000-0000-00000c3a0301',
        '00000000-0000-0000-0000-0000000ec301',
        'claim-test-preclaimed-att',
        'preclaimed_doc.pdf',
        'application/pdf',
        NOW(),
        NOW());

------------------------------------------------------------
-- Thread for pre-claimed media test
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c401',
        '00000000-0000-0000-0000-000000000c01',
        false, false, NOW(), NOW());

-- Message with pre-claimed media attachment
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ec401',
        '00000000-0000-0000-0000-00000000c401',
        '00000000-0000-0000-0000-000000000c01',
        'claim-test-preclaimed-media-msg',
        FALSE,
        '00000000-0000-0000-0000-00000c0c0001',
        '2025-01-01 13:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Pre-claimed media attachment (already has upload_claimed_at set)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, upload_claimed_at, created_at)
VALUES ('00000000-0000-0000-0000-00000c4a0401',
        '00000000-0000-0000-0000-0000000ec401',
        'claim-test-preclaimed-media-att',
        'preclaimed_image.jpg',
        'image/jpeg',
        NOW(),
        NOW());
