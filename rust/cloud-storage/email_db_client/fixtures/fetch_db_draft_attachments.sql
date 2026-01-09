-- SQL fixture for fetch_db_draft_attachments tests
-- Tests fetching draft attachments by draft_id, ordered by file_name

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01', 'macro|fetch_draft_att_user@example.com', '00000000-0000-0000-0000-000000000f01',
        'fetch_draft_att_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf001',
        '00000000-0000-0000-0000-000000000f01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Draft Message 1: Has multiple attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f501',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-draft-f501',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Attachment 1: zulu_file.txt (should be last alphabetically)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa001',
        '00000000-0000-0000-0000-00000000f501',
        'zulu_file.txt',
        'text/plain',
        'sha256_zulu',
        1500,
        's3://bucket/draft/f501/fa001',
        NOW());

-- Attachment 2: alpha_doc.pdf (should be first alphabetically)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa002',
        '00000000-0000-0000-0000-00000000f501',
        'alpha_doc.pdf',
        'application/pdf',
        'sha256_alpha',
        2500,
        's3://bucket/draft/f501/fa002',
        NOW());

-- Attachment 3: mike_image.png (should be in the middle)
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000fa003',
        '00000000-0000-0000-0000-00000000f501',
        'mike_image.png',
        'image/png',
        'sha256_mike',
        3500,
        's3://bucket/draft/f501/fa003',
        NOW());

------------------------------------------------------------
-- Draft Message 2: No attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f502',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-draft-f502',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, true, NOW(), NOW());