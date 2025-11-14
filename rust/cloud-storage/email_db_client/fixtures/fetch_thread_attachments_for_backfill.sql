-- SQL fixture for fetch_thread_attachments_for_backfill tests
-- This file seeds:
-- - 4 threads (3 matching the conditions, 1 control with no matches)
-- - Messages, contacts, labels, attachments

-- NOTE:
-- - Adjust column lists and extra NOT NULL fields according to your actual schema.
-- - All UUIDs are hard-coded so tests can reference them.

------------------------------------------------------------
-- Common: links + threads
------------------------------------------------------------

-- Link A: user email is user_a@example.com
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at,
                         updated_at)
VALUES ('00000000-0000-0000-0000-00000000001a', 'macro|user_a@example.com', '00000000-0000-0000-0000-00000000001a',
        'user_a@example.com', 'GMAIL', true, '2025-11-11 17:48:26.664688 +00:00',
        '2025-11-11 17:48:26.664688 +00:00');

-- Thread 1: used for condition 1 (is_sent = true)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        false,
        false,
        NOW(),
        NOW());

-- Thread 2: used for condition 2 (IMPORTANT label)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        false,
        false,
        NOW(),
        NOW());

-- Thread 3: used for condition 3 (same-domain from contact)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        false,
        false,
        NOW(),
        NOW());

-- Thread 4: control thread: no messages satisfy any condition
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        false,
        false,
        NOW(),
        NOW());

------------------------------------------------------------
-- Labels
------------------------------------------------------------

-- IMPORTANT label
INSERT INTO email_labels (id, provider_label_id, link_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-0000000a0001',
        'IMPORTANT',
        '00000000-0000-0000-0000-00000000001a',
        'IMPORTANT',
        'Show',
        'LabelShow',
        'System',
        NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

-- Contact with same domain as user_a@example.com
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-00000000001a',
        'sender_same@example.com',
        NOW(),
        NOW());

-- Contact with different domain
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002',
        '00000000-0000-0000-0000-00000000001a',
        'sender_other@other.com',
        NOW(),
        NOW());

------------------------------------------------------------
-- Thread 1: Condition 1 - is_sent = true
------------------------------------------------------------

-- Message: is_sent = true, no labels, from_contact_id = NULL
INSERT INTO email_messages (id,
                            thread_id,
                            link_id,
                            provider_id,
                            is_sent,
                            from_contact_id,
                            internal_date_ts,
                            has_attachments,
                            is_read,
                            is_starred,
                            is_draft,
                            created_at,
                            updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0001',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-101',
        TRUE,
        NULL,
        NOW(),
        true,
        false,
        false,
        false,
        NOW(),
        NOW());

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id,
                               message_id,
                               provider_attachment_id,
                               filename,
                               mime_type,
                               created_at)
VALUES ('00000000-0000-0000-0000-0000001a0101',
        '00000000-0000-0000-0000-0000000b0001',
        'provider-att-101',
        'sent_doc.pdf',
        'application/pdf',
        NOW());

-- Filtered attachments (should NOT be returned)
INSERT INTO email_attachments (id,
                               message_id,
                               provider_attachment_id,
                               filename,
                               mime_type,
                               created_at)
VALUES ('00000000-0000-0000-0000-0000001a0102',
        '00000000-0000-0000-0000-0000000b0001',
        'provider-att-102',
        'image_attachment.png',
        'image/png',
        NOW()),
       ('00000000-0000-0000-0000-0000001a0103',
        '00000000-0000-0000-0000-0000000b0001',
        'provider-att-103',
        'archive.zip',
        'application/zip',
        NOW()),
       ('00000000-0000-0000-0000-0000001a0104',
        '00000000-0000-0000-0000-0000000b0001',
        'provider-att-104',
        'calendar.ics',
        'application/ics',
        NOW());

------------------------------------------------------------
-- Thread 2: Condition 2 - IMPORTANT label
------------------------------------------------------------

-- Message: is_sent = false, but labeled IMPORTANT
INSERT INTO email_messages (id,
                            thread_id,
                            link_id,
                            provider_id,
                            is_sent,
                            from_contact_id,
                            internal_date_ts,
                            has_attachments,
                            is_read,
                            is_starred,
                            is_draft,
                            created_at,
                            updated_at)
VALUES ('00000000-0000-0000-0000-0000002a0201',
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-201',
        FALSE,
        NULL,
        NOW(),
        true,
        false,
        false,
        false,
        NOW(),
        NOW());

-- Associate IMPORTANT label
INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-0000002a0201',
        '00000000-0000-0000-0000-0000000a0001');

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id,
                               message_id,
                               provider_attachment_id,
                               filename,
                               mime_type,
                               created_at)
VALUES ('00000000-0000-0000-0000-0000002a0201',
        '00000000-0000-0000-0000-0000002a0201',
        'provider-att-201',
        'important_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 3: Condition 3 - same-domain from contact
------------------------------------------------------------

-- Message: is_sent = false, from contact with same domain as link's email
INSERT INTO email_messages (id,
                            thread_id,
                            link_id,
                            provider_id,
                            is_sent,
                            from_contact_id,
                            internal_date_ts,
                            has_attachments,
                            is_read,
                            is_starred,
                            is_draft,
                            created_at,
                            updated_at)
VALUES ('00000000-0000-0000-0000-00000000e301',
        '00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-301',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001',
        NOW(),
        true,
        false,
        false,
        false,
        NOW(),
        NOW());

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id,
                               message_id,
                               provider_attachment_id,
                               filename,
                               mime_type,
                               created_at)
VALUES ('00000000-0000-0000-0000-0000003a0301',
        '00000000-0000-0000-0000-00000000e301',
        'provider-att-301',
        'same_domain_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 4: No condition met (no attachments should be returned)
------------------------------------------------------------

-- Message: is_sent = false, from different-domain contact, no labels
INSERT INTO email_messages (id,
                            thread_id,
                            link_id,
                            provider_id,
                            is_sent,
                            from_contact_id,
                            internal_date_ts,
                            has_attachments,
                            is_read,
                            is_starred,
                            is_draft,
                            created_at,
                            updated_at)
VALUES ('00000000-0000-0000-0000-00000000e401',
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-401',
        FALSE,
        '00000000-0000-0000-0000-0000000c0002',
        NOW(),
        true,
        false,
        false,
        false,
        NOW(),
        NOW());

-- Attachments exist but should not be returned because EXISTS condition fails
INSERT INTO email_attachments (id,
                               message_id,
                               provider_attachment_id,
                               filename,
                               mime_type,
                               created_at)
VALUES ('00000000-0000-0000-0000-0000004a0401',
        '00000000-0000-0000-0000-00000000e401',
        'provider-att-401',
        'unmatched_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- End of fixture
------------------------------------------------------------