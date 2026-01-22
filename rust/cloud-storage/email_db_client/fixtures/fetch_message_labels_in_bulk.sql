-- SQL fixture for fetch_message_labels_in_bulk tests
-- Tests fetching message labels for multiple message IDs in a single query

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000801', 'macro|bulk_labels_user@example.com', '00000000-0000-0000-0000-000000000801',
        'bulk_labels_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contact
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c8001',
        '00000000-0000-0000-0000-000000000801',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Labels
------------------------------------------------------------

-- Label 1: INBOX (System)
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-000000018001',
        '00000000-0000-0000-0000-000000000801',
        'INBOX',
        'INBOX',
        'Show',
        'LabelShow',
        'System',
        NOW());

-- Label 2: IMPORTANT (System)
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-000000018002',
        '00000000-0000-0000-0000-000000000801',
        'IMPORTANT',
        'IMPORTANT',
        'Show',
        'LabelShowIfUnread',
        'System',
        NOW());

-- Label 3: Work (User)
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-000000018003',
        '00000000-0000-0000-0000-000000000801',
        'Label_Work',
        'Work',
        'Show',
        'LabelShow',
        'User',
        NOW());

-- Label 4: Personal (User)
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES ('00000000-0000-0000-0000-000000018004',
        '00000000-0000-0000-0000-000000000801',
        'Label_Personal',
        'Personal',
        'Hide',
        'LabelHide',
        'User',
        NOW());

------------------------------------------------------------
-- Thread
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000008201',
        '00000000-0000-0000-0000-000000000801',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Has multiple labels (INBOX, Work)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000008501',
        '00000000-0000-0000-0000-000000008201',
        '00000000-0000-0000-0000-000000000801',
        'provider-msg-8501',
        FALSE,
        '00000000-0000-0000-0000-0000000c8001',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-000000008501', '00000000-0000-0000-0000-000000018001');

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-000000008501', '00000000-0000-0000-0000-000000018003');

------------------------------------------------------------
-- Message 2: Has one label (IMPORTANT)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000008502',
        '00000000-0000-0000-0000-000000008201',
        '00000000-0000-0000-0000-000000000801',
        'provider-msg-8502',
        FALSE,
        '00000000-0000-0000-0000-0000000c8001',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('00000000-0000-0000-0000-000000008502', '00000000-0000-0000-0000-000000018002');

------------------------------------------------------------
-- Message 3: No labels
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000008503',
        '00000000-0000-0000-0000-000000008201',
        '00000000-0000-0000-0000-000000000801',
        'provider-msg-8503',
        FALSE,
        '00000000-0000-0000-0000-0000000c8001',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());
