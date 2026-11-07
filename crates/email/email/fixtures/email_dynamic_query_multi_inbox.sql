-- Fixture for multi-inbox testing: a second email link owned by the SAME user
-- as email_dynamic_query's link, with its own sent thread.
-- Composes on top of the email_dynamic_query fixture.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'macro|user1@test.com', 'user1', 'user1.alt@gmail.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('40000201-0000-0000-0000-000000000201', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'user1.alt@gmail.com', 'User One Alt', NOW(), NOW()),
    ('40000202-0000-0000-0000-000000000202', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'jane@example.com', 'Jane Smith', NOW(), NOW());

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('10000201-0000-0000-0000-000000000201', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'SENT', 'SENT', 'Show', 'LabelShow', 'System', NOW()),
    ('10000202-0000-0000-0000-000000000202', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- Thread 201: sent from the second inbox, newer than the first inbox's sent thread
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('20000201-0000-0000-0000-000000000201', 'alt_thread1', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
     false, true, NULL, '2024-01-16 12:00:00+00', '2024-01-16 12:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('30000201-0000-0000-0000-000000000201', '20000201-0000-0000-0000-000000000201',
     'dddddddd-dddd-dddd-dddd-dddddddddddd', 'alt_msg1', '40000201-0000-0000-0000-000000000201',
     'Sent From Alt Inbox', 'Sent from the secondary inbox', '2024-01-16 12:00:00+00',
     false, true, false, true, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    ('30000201-0000-0000-0000-000000000201', '40000202-0000-0000-0000-000000000202', 'TO');

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('30000201-0000-0000-0000-000000000201', '10000201-0000-0000-0000-000000000201');
