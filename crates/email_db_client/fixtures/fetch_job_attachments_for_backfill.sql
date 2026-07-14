-- SQL fixture for fetch_job_attachments_for_backfill tests
-- This file seeds scenarios to test the job-level attachment backfill logic:
-- - Attachments from threads with previously contacted participants (should be included)
-- - Attachments from threads with no previously contacted participants (should be excluded)
-- - Various filter scenarios (mime types, filenames)

-- NOTE:
-- - All UUIDs are hard-coded so tests can reference them.
-- - User email: user_a@example.com

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001a', 'macro|user_a@example.com', '00000000-0000-0000-0000-00000000001a',
        'user_a@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

-- Previously contacted person (user sent email to this person)
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-00000000001a',
        'previously_contacted@example.com',
        NOW(), NOW());

-- Person user has never contacted before
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002',
        '00000000-0000-0000-0000-00000000001a',
        'never_contacted@example.com',
        NOW(), NOW());

-- Another previously contacted person
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0003',
        '00000000-0000-0000-0000-00000000001a',
        'also_contacted@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Threads
------------------------------------------------------------

-- Thread 1: Contains previously contacted participant (should include attachments)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 2: Contains NO previously contacted participants (should exclude attachments)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 3: Mixed - has both contacted and non-contacted participants (should include)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 4: User sent message establishing "previously contacted" relationship
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

------------------------------------------------------------
-- Thread 4: Establish "previously contacted" relationships
------------------------------------------------------------

-- User sent message to previously_contacted@example.com (creates the relationship)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0401',
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-401',
        TRUE, -- is_sent = true (user sent this)
        NULL,  -- from_contact_id is NULL for sent messages
        '2025-01-01 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

-- Add recipient for the sent message
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000e0401',
        '00000000-0000-0000-0000-0000000c0001', -- previously_contacted@example.com
        'TO');

-- User sent message to also_contacted@example.com (creates another relationship)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0402',
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-402',
        TRUE, -- is_sent = true
        NULL,
        '2025-01-01 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000e0402',
        '00000000-0000-0000-0000-0000000c0003', -- also_contacted@example.com
        'TO');

------------------------------------------------------------
-- Thread 1: With previously contacted participant
------------------------------------------------------------

-- Message from previously contacted person (should include its attachments)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0101',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-101',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001', -- from previously_contacted@example.com
        '2025-01-02 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0101',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-101',
        'valid_document.pdf',
        'application/pdf',
        NOW());

-- Filtered attachment (should NOT be returned - image)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0102',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-102',
        'image.jpg',
        'image/jpeg',
        NOW());

-- Filtered attachment (should NOT be returned - zip)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0103',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-103',
        'archive.zip',
        'application/zip',
        NOW());

-- Filtered attachment (should NOT be returned - ics)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0104',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-104',
        'calendar.ics',
        'application/ics',
        NOW());

-- Filtered attachment (should NOT be returned - no filename)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0105',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-105',
        NULL,
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 2: With NO previously contacted participants
------------------------------------------------------------

-- Message from never contacted person (should NOT include its attachments)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0201',
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-201',
        FALSE,
        '00000000-0000-0000-0000-0000000c0002', -- from never_contacted@example.com
        '2025-01-02 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- This attachment should NOT be returned (thread has no previously contacted participants)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000002a0201',
        '00000000-0000-0000-0000-0000000e0201',
        'provider-att-201',
        'excluded_document.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 3: Mixed participants (has both contacted and non-contacted)
------------------------------------------------------------

-- Message from previously contacted person
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0301',
        '00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-301',
        FALSE,
        '00000000-0000-0000-0000-0000000c0003', -- from also_contacted@example.com
        '2025-01-02 12:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- This attachment should be returned (thread has at least one previously contacted participant)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000003a0301',
        '00000000-0000-0000-0000-0000000e0301',
        'provider-att-301',
        'mixed_thread_doc.pdf',
        'application/pdf',
        NOW());

-- Message from never contacted person in same thread
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0302',
        '00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-302',
        FALSE,
        '00000000-0000-0000-0000-0000000c0002', -- from never_contacted@example.com
        '2025-01-02 13:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- This attachment should ALSO be returned (same thread, has contacted participant)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000003a0302',
        '00000000-0000-0000-0000-0000000e0302',
        'provider-att-302',
        'also_included_doc.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        NOW());

------------------------------------------------------------
-- End of fixture
------------------------------------------------------------