-- SQL fixture for keeping draft attachments out of the document auto-import.
-- One thread qualifies by every rule: the user sent a message in it to a
-- contact, and that contact replied. The reply's attachment is imported; the
-- user's draft reply in the same thread carries an attachment that is not.

-- NOTE:
-- - All UUIDs are hard-coded so tests can reference them.
-- - User email: drafter@example.com

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000d01', 'macro|drafter@example.com', '00000000-0000-0000-0000-000000000d01',
        'drafter@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000d0c0000',
        '00000000-0000-0000-0000-000000000d01',
        'drafter@example.com',
        NOW(), NOW()),
       ('00000000-0000-0000-0000-00000d0c0001',
        '00000000-0000-0000-0000-000000000d01',
        'correspondent@example.com',
        NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d101',
        '00000000-0000-0000-0000-000000000d01',
        true, false, NOW(), NOW());

-- The user's sent message to the correspondent.
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ed101',
        '00000000-0000-0000-0000-00000000d101',
        '00000000-0000-0000-0000-000000000d01',
        'draft-test-sent-msg',
        TRUE,
        '00000000-0000-0000-0000-00000d0c0000',
        '2025-01-01 10:00:00 +00:00',
        false, true, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000ed101',
        '00000000-0000-0000-0000-00000d0c0001',
        'TO');

-- The correspondent's reply, with an attachment.
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ed102',
        '00000000-0000-0000-0000-00000000d101',
        '00000000-0000-0000-0000-000000000d01',
        'draft-test-received-msg',
        FALSE,
        '00000000-0000-0000-0000-00000d0c0001',
        '2025-01-01 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000ed102',
        '00000000-0000-0000-0000-00000d0c0000',
        'TO');

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000d5a0102',
        '00000000-0000-0000-0000-0000000ed102',
        'draft-test-received-att',
        'received_doc.pdf',
        'application/pdf',
        NOW());

-- The user's draft reply, with an attachment.
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ed103',
        '00000000-0000-0000-0000-00000000d101',
        '00000000-0000-0000-0000-000000000d01',
        'draft-test-draft-msg',
        FALSE,
        '00000000-0000-0000-0000-00000d0c0000',
        '2025-01-01 12:00:00 +00:00',
        true, true, false, true, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES ('00000000-0000-0000-0000-0000000ed103',
        '00000000-0000-0000-0000-00000d0c0001',
        'TO');

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, created_at)
VALUES ('00000000-0000-0000-0000-00000d5a0103',
        '00000000-0000-0000-0000-0000000ed103',
        'draft-test-draft-att',
        'draft_doc.pdf',
        'application/pdf',
        NOW());
