-- SQL fixture for fetch_db_draft_attachments_in_bulk tests
-- Tests fetching draft attachments for multiple draft IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000b01', 'macro|bulk_draft_user@example.com', '00000000-0000-0000-0000-000000000b01',
        'bulk_draft_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cb001',
        '00000000-0000-0000-0000-000000000b01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Draft Message 1: Has multiple attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b501',
        '00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        NULL,
        FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Draft 1 Attachment 1: alpha_file.pdf
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000ba001',
        '00000000-0000-0000-0000-00000000b501',
        'alpha_file.pdf',
        'application/pdf',
        'sha256_alpha_d1',
        1000,
        's3://bucket/draft/b501/ba001',
        NOW());

-- Draft 1 Attachment 2: bravo_image.png
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000ba002',
        '00000000-0000-0000-0000-00000000b501',
        'bravo_image.png',
        'image/png',
        'sha256_bravo_d1',
        2000,
        's3://bucket/draft/b501/ba002',
        NOW());

------------------------------------------------------------
-- Draft Message 2: Has one attachment
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b502',
        '00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        NULL,
        FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-05 11:00:00 +00:00',
        true, false, false, true, NOW(), NOW());

-- Draft 2 Attachment 1: zulu_file.txt
INSERT INTO email_attachments_drafts (id, draft_id, file_name, content_type, sha, size, s3_key, created_at)
VALUES ('00000000-0000-0000-0000-0000000ba003',
        '00000000-0000-0000-0000-00000000b502',
        'zulu_file.txt',
        'text/plain',
        'sha256_zulu_d2',
        500,
        's3://bucket/draft/b502/ba003',
        NOW());

------------------------------------------------------------
-- Draft Message 3: No attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b503',
        '00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        NULL,
        FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, true, NOW(), NOW());
