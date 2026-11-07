-- SQL fixture for draft_attachments tests
-- Tests insert, fetch, delete, and total size operations for draft attachments

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000d01', 'macro|draft_user@example.com', '00000000-0000-0000-0000-000000000d01',
        'draft_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Second link for testing cross-link access prevention
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000d02', 'macro|other_user@example.com', '00000000-0000-0000-0000-000000000d02',
        'other_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cd001',
        '00000000-0000-0000-0000-000000000d01',
        'draft_sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Draft Message 1: Has multiple attachments (for fetch and total size tests)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d501',
        '00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        'provider-draft-501',
        FALSE,
        '00000000-0000-0000-0000-0000000cd001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Attachment 1: alpha_file.pdf (size: 1000)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000da001',
        '00000000-0000-0000-0000-00000000d501',
        'alpha_file.pdf',
        'application/pdf',
        'sha256_alpha',
        1000,
        's3://bucket/alpha_file.pdf',
        NOW());

-- Attachment 2: bravo_image.png (size: 2000)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000da002',
        '00000000-0000-0000-0000-00000000d501',
        'bravo_image.png',
        'image/png',
        'sha256_bravo',
        2000,
        's3://bucket/bravo_image.png',
        NOW());

-- Attachment 3: zulu_doc.docx (size: 3000)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000da003',
        '00000000-0000-0000-0000-00000000d501',
        'zulu_doc.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'sha256_zulu',
        3000,
        's3://bucket/zulu_doc.docx',
        NOW());

------------------------------------------------------------
-- Draft Message 2: Empty draft (no attachments, for insert test)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d502',
        '00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        'provider-draft-502',
        FALSE,
        '00000000-0000-0000-0000-0000000cd001',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

------------------------------------------------------------
-- Draft Message 3: Single attachment (for delete test)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000d503',
        '00000000-0000-0000-0000-00000000d201',
        '00000000-0000-0000-0000-000000000d01',
        'provider-draft-503',
        FALSE,
        '00000000-0000-0000-0000-0000000cd001',
        '2025-01-05 12:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Attachment for delete test
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000da004',
        '00000000-0000-0000-0000-00000000d503',
        'delete_me.txt',
        'text/plain',
        'sha256_delete',
        500,
        's3://bucket/delete_me.txt',
        NOW());