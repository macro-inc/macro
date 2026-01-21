-- SQL fixture for fetch_db_macro_attachments_in_bulk tests
-- Tests fetching macro attachments for multiple message IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000c01', 'macro|bulk_macro_att_user@example.com', '00000000-0000-0000-0000-000000000c01',
        'bulk_macro_att_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cc001',
        '00000000-0000-0000-0000-000000000c01',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Has multiple macro attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c501',
        '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        'provider-msg-c501',
        FALSE,
        '00000000-0000-0000-0000-0000000cc001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Message 1 Macro Attachment 1: Document
INSERT INTO email_attachments_macro (id, message_id, item_id, item_type, created_at)
VALUES ('00000000-0000-0000-0000-0000000ca001',
        '00000000-0000-0000-0000-00000000c501',
        '00000000-0000-0000-0000-000000001001',
        'document',
        NOW());

-- Message 1 Macro Attachment 2: Image
INSERT INTO email_attachments_macro (id, message_id, item_id, item_type, created_at)
VALUES ('00000000-0000-0000-0000-0000000ca002',
        '00000000-0000-0000-0000-00000000c501',
        '00000000-0000-0000-0000-000000001002',
        'image',
        NOW());

------------------------------------------------------------
-- Message 2: Has one macro attachment
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c502',
        '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        'provider-msg-c502',
        FALSE,
        '00000000-0000-0000-0000-0000000cc001',
        '2025-01-05 11:00:00 +00:00',
        true, false, false, false, NOW(), NOW());

-- Message 2 Macro Attachment 1: Video
INSERT INTO email_attachments_macro (id, message_id, item_id, item_type, created_at)
VALUES ('00000000-0000-0000-0000-0000000ca003',
        '00000000-0000-0000-0000-00000000c502',
        '00000000-0000-0000-0000-000000001003',
        'video',
        NOW());

------------------------------------------------------------
-- Message 3: No macro attachments
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c503',
        '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01',
        'provider-msg-c503',
        FALSE,
        '00000000-0000-0000-0000-0000000cc001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());
