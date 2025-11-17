
-- SQL fixture for fetch_insertable_attachments_for_new_email tests
-- This file seeds scenarios to test all conditions for new email attachment insertion:
-- 1. User sent the message (is_sent = true)
-- 2. Message has IMPORTANT label
-- 3. Message from same domain as user
-- 4. Message from whitelisted domain
-- 5. User has previously contacted a thread participant
-- Also tests document_email exclusion logic

-- NOTE:
-- - All UUIDs are hard-coded so tests can reference them
-- - User email: user_a@example.com

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001a', 'macro|user_a@example.com', '00000000-0000-0000-0000-00000000001a',
        'user_a@example.com', 'GMAIL', true, NOW(), NOW());

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

-- Same domain contact (user_a@example.com -> same_domain@example.com)
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0001',
        '00000000-0000-0000-0000-00000000001a',
        'same_domain@example.com',
        NOW(), NOW());

-- Different domain contact
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0002',
        '00000000-0000-0000-0000-00000000001a',
        'different@other.com',
        NOW(), NOW());

-- Previously contacted person
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0003',
        '00000000-0000-0000-0000-00000000001a',
        'previously_contacted@other.com',
        NOW(), NOW());

-- Never contacted person
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0004',
        '00000000-0000-0000-0000-00000000001a',
        'never_contacted@other.com',
        NOW(), NOW());

-- Whitelisted domain contact (docusign.com)
INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0005',
        '00000000-0000-0000-0000-00000000001a',
        'noreply@docusign.com',
        NOW(), NOW());

------------------------------------------------------------
-- Threads
------------------------------------------------------------

-- Thread 1: For condition 1 testing (sent message)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 2: For condition 2 testing (IMPORTANT label)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 3: For condition 3 testing (same domain)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 4: For condition 5 testing (previously contacted)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 5: For establishing "previously contacted" relationship
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000105',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 6: Control thread (no conditions met)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000106',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 7: For document_email exclusion testing
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000107',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

-- Thread 8: For condition 4 testing (whitelisted domain)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000108',
        '00000000-0000-0000-0000-00000000001a',
        false, false, NOW(), NOW());

------------------------------------------------------------
-- Thread 5: Establish "previously contacted" relationship
------------------------------------------------------------

-- User sent message to previously_contacted@other.com (establishes relationship)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0501',
        '00000000-0000-0000-0000-000000000105',
        '00000000-0000-0000-0000-00000000001a',
        'provider-msg-501',
        TRUE, -- is_sent = true
        NULL,  -- from_contact_id is NULL for sent messages
        '2025-01-01 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

-- Add recipient for the sent message
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000e0501',
        '00000000-0000-0000-0000-0000000c0003', -- previously_contacted@other.com
        'TO');

------------------------------------------------------------
-- Thread 1: Condition 1 - User sent message (is_sent = true)
------------------------------------------------------------

-- Target message with attachment (user sent this)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0101',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-101',
        TRUE, -- This makes condition 1 true for the thread
        NULL,
        '2025-01-02 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0101',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-101',
        'sent_message_doc.pdf',
        'application/pdf',
        NOW());

-- Filtered attachments (should NOT be returned)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000001a0102',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-102',
        'image.jpg',
        'image/jpeg',
        NOW()),
       ('00000000-0000-0000-0000-0000001a0103',
        '00000000-0000-0000-0000-0000000e0101',
        'provider-att-103',
        'archive.zip',
        'application/zip',
        NOW());

------------------------------------------------------------
-- Thread 2: Condition 2 - IMPORTANT label
------------------------------------------------------------

-- Target message with attachment (has IMPORTANT label)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0201',
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-201',
        FALSE,
        '00000000-0000-0000-0000-0000000c0002', -- from different@other.com
        '2025-01-02 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Associate IMPORTANT label
INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-0000000e0201',
        '00000000-0000-0000-0000-0000000a0001');

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000002a0201',
        '00000000-0000-0000-0000-0000000e0201',
        'provider-att-201',
        'important_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 3: Condition 3 - Same domain sender
------------------------------------------------------------

-- Target message with attachment (from same domain)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0301',
        '00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-301',
        FALSE,
        '00000000-0000-0000-0000-0000000c0001', -- from same_domain@example.com
        '2025-01-02 12:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Valid attachment (should be returned)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000003a0301',
        '00000000-0000-0000-0000-0000000e0301',
        'provider-att-301',
        'same_domain_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 4: Condition 5 - Previously contacted participant
------------------------------------------------------------

-- Target message with attachment
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0401',
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-401',
        FALSE,
        '00000000-0000-0000-0000-0000000c0003', -- from previously_contacted@other.com
        '2025-01-02 13:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Valid attachment (should be returned by second query)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000004a0401',
        '00000000-0000-0000-0000-0000000e0401',
        'provider-att-401',
        'previously_contacted_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 6: Control - No conditions met
------------------------------------------------------------

-- Target message with attachment (no conditions met)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0601',
        '00000000-0000-0000-0000-000000000106',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-601',
        FALSE,
        '00000000-0000-0000-0000-0000000c0004', -- from never_contacted@other.com
        '2025-01-02 14:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- This attachment should NOT be returned
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000006a0601',
        '00000000-0000-0000-0000-0000000e0601',
        'provider-att-601',
        'excluded_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 7: Document_email exclusion testing
------------------------------------------------------------

-- Target message with attachment that's already in document_email
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0701',
        '00000000-0000-0000-0000-000000000107',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-701',
        TRUE, -- is_sent = true (condition 1 met)
        NULL,
        '2025-01-02 15:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Attachment that already exists in document_email (should be excluded)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000007a0701',
        '00000000-0000-0000-0000-0000000e0701',
        'provider-att-701',
        'already_uploaded_doc.pdf',
        'application/pdf',
        NOW());

------------------------------------------------------------
-- Thread 8: Condition 4 - Whitelisted domain
------------------------------------------------------------

-- Target message with attachment (from whitelisted domain)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0801',
        '00000000-0000-0000-0000-000000000108',
        '00000000-0000-0000-0000-00000000001a',
        'target-msg-801',
        FALSE,
        '00000000-0000-0000-0000-0000000c0005', -- from noreply@docusign.com
        '2025-01-02 16:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Valid attachment (should be returned due to whitelisted domain)
INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-0000008a0801',
        '00000000-0000-0000-0000-0000000e0801',
        'provider-att-801',
        'whitelisted_domain_doc.pdf',
        'application/pdf',
        NOW());

-- Macro user for the User table foreign key
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('00000000-0000-0000-0000-00000000001a',
        'user_a',
        'user_a@example.com',
        'cus_test123');

-- User for the document owner
INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('00000000-0000-0000-0000-00000000001a',
        'user_a@example.com',
        'User A',
        '00000000-0000-0000-0000-00000000001a');

INSERT INTO "Document" (id, name, owner, "fileType", uploaded, "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-00000000d701',
        'already_uploaded_doc.pdf',
        '00000000-0000-0000-0000-00000000001a',
        'application/pdf',
        true,
        NOW(),
        NOW());


-- Simulate document_email entry (attachment already uploaded)
INSERT INTO document_email (document_id, email_attachment_id)
VALUES ('00000000-0000-0000-0000-00000000d701',
        '00000000-0000-0000-0000-0000007a0701');

------------------------------------------------------------
-- Additional messages in threads to test EXISTS logic
------------------------------------------------------------


------------------------------------------------------------
-- End of fixture
------------------------------------------------------------