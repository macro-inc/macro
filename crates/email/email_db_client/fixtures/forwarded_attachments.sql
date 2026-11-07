-- SQL fixture for forwarded_attachments tests
-- Tests insert, fetch, delete operations for forwarded attachment links

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01', 'macro|fwd_user@example.com', '00000000-0000-0000-0000-000000000f01',
        'fwd_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Second link for testing cross-link access prevention
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f02', 'macro|fwd_other@example.com', '00000000-0000-0000-0000-000000000f02',
        'fwd_other@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf001',
        '00000000-0000-0000-0000-000000000f01',
        'fwd_sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Original Message (the one being forwarded, has attachments)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f301',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'gmail-original-msg-001',
        TRUE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 10:00:00 +00:00',
        true, true, false, false, NOW(), NOW());

-- Original message attachments (in email_attachments table)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa001',
        '00000000-0000-0000-0000-00000000f301',
        'gmail-att-id-001',
        'report.pdf',
        'application/pdf',
        50000,
        NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa002',
        '00000000-0000-0000-0000-00000000f301',
        'gmail-att-id-002',
        'photo.jpg',
        'image/jpeg',
        120000,
        NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa003',
        '00000000-0000-0000-0000-00000000f301',
        'gmail-att-id-003',
        'notes.txt',
        'text/plain',
        500,
        NOW());

------------------------------------------------------------
-- Draft Message 1: Has forwarded attachments (for fetch and delete tests)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f501',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-fwd-draft-501',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 11:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Link draft 1 to two original attachments
INSERT INTO email_attachments_fwd (message_id, attachment_id)
VALUES ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-0000000fa001');

INSERT INTO email_attachments_fwd (message_id, attachment_id)
VALUES ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-0000000fa002');

------------------------------------------------------------
-- Draft Message 2: Empty draft (no forwarded attachments, for insert test)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f502',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-fwd-draft-502',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

------------------------------------------------------------
-- Draft Message 3: Single forwarded attachment (for delete test)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f503',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-fwd-draft-503',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 13:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

INSERT INTO email_attachments_fwd (message_id, attachment_id)
VALUES ('00000000-0000-0000-0000-00000000f503', '00000000-0000-0000-0000-0000000fa003');
