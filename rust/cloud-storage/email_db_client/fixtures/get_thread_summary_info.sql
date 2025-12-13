
-- SQL fixture for get_thread_summary_info tests
-- Tests the timestamp logic for first_message_ts and last_message_ts
-- COALESCE rules:
-- - first_message_ts: MIN(sent_at) for non-drafts, fallback to MIN(updated_at)
-- - last_message_ts: MAX(sent_at) for non-drafts, fallback to MAX(updated_at)

------------------------------------------------------------
-- User Link
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001c', 'macro|user_c@example.com', '00000000-0000-0000-0000-00000000001c',
        'user_c@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000c0020',
        '00000000-0000-0000-0000-00000000001c',
        'alice@example.com',
        'Alice Smith',
        NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000c0021',
        '00000000-0000-0000-0000-00000000001c',
        'bob@example.com',
        'Bob Jones',
        NOW(), NOW());

------------------------------------------------------------
-- Thread 1: All non-draft messages with sent_at
-- Should use MIN(sent_at) and MAX(sent_at)
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0601',
        '00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-601',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-10 10:00:00 +00:00',
        '2025-01-10 10:00:00 +00:00',
        false,
        'First message snippet',
        'Test Subject 1',
        '2025-01-10 09:00:00 +00:00',
        '2025-01-10 09:30:00 +00:00'),
       ('00000000-0000-0000-0000-0000000e0602',
        '00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-602',
        FALSE,
        '00000000-0000-0000-0000-0000000c0021',
        '2025-01-10 11:00:00 +00:00',
        '2025-01-10 11:00:00 +00:00',
        false,
        'Second message snippet',
        'Test Subject 1',
        '2025-01-10 10:00:00 +00:00',
        '2025-01-10 10:30:00 +00:00'),
       ('00000000-0000-0000-0000-0000000e0603',
        '00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-603',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-10 12:00:00 +00:00',
        '2025-01-10 12:00:00 +00:00',
        false,
        'Latest message snippet',
        'Test Subject 1',
        '2025-01-10 11:00:00 +00:00',
        '2025-01-10 11:30:00 +00:00');

------------------------------------------------------------
-- Thread 2: All draft messages (no sent_at)
-- Should fallback to MIN(updated_at) and MAX(updated_at)
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0604',
        '00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-604',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-11 10:00:00 +00:00',
        NULL,
        true,
        'Draft 1',
        'Draft Subject',
        '2025-01-11 09:00:00 +00:00',
        '2025-01-11 09:15:00 +00:00'),
       ('00000000-0000-0000-0000-0000000e0605',
        '00000000-0000-0000-0000-000000000302',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-605',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-11 11:00:00 +00:00',
        NULL,
        true,
        'Draft 2',
        'Draft Subject',
        '2025-01-11 10:00:00 +00:00',
        '2025-01-11 10:45:00 +00:00');

------------------------------------------------------------
-- Thread 3: Mix of drafts and non-drafts
-- Should use sent_at from non-drafts only
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

-- Draft with earliest updated_at (should be ignored for first_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0606',
        '00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-606',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-12 08:00:00 +00:00',
        NULL,
        true,
        'Early draft',
        'Mixed Subject',
        '2025-01-12 07:00:00 +00:00',
        '2025-01-12 07:30:00 +00:00');

-- Non-draft (should be used for first_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0607',
        '00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-607',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-12 10:00:00 +00:00',
        '2025-01-12 10:00:00 +00:00',
        false,
        'First real message',
        'Mixed Subject',
        '2025-01-12 09:00:00 +00:00',
        '2025-01-12 09:30:00 +00:00');

-- Draft with latest updated_at (should be ignored for last_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0608',
        '00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-608',
        FALSE,
        '00000000-0000-0000-0000-0000000c0021',
        '2025-01-12 15:00:00 +00:00',
        NULL,
        true,
        'Latest draft',
        'Mixed Subject',
        '2025-01-12 14:00:00 +00:00',
        '2025-01-12 14:30:00 +00:00');

-- Non-draft (should be used for last_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0609',
        '00000000-0000-0000-0000-000000000303',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-609',
        FALSE,
        '00000000-0000-0000-0000-0000000c0021',
        '2025-01-12 12:00:00 +00:00',
        '2025-01-12 12:00:00 +00:00',
        false,
        'Latest real message',
        'Mixed Subject',
        '2025-01-12 11:00:00 +00:00',
        '2025-01-12 11:30:00 +00:00');

------------------------------------------------------------
-- Thread 4: Non-drafts with NULL sent_at
-- Should fallback to updated_at
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000304',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0610',
        '00000000-0000-0000-0000-000000000304',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-610',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-13 10:00:00 +00:00',
        NULL,
        false,
        'Message without sent_at',
        'No Sent Subject',
        '2025-01-13 09:00:00 +00:00',
        '2025-01-13 09:20:00 +00:00'),
       ('00000000-0000-0000-0000-0000000e0611',
        '00000000-0000-0000-0000-000000000304',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-611',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-13 11:00:00 +00:00',
        NULL,
        false,
        'Another message without sent_at',
        'No Sent Subject',
        '2025-01-13 10:00:00 +00:00',
        '2025-01-13 10:40:00 +00:00');

------------------------------------------------------------
-- Thread 5: Single message (edge case)
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000305',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0612',
        '00000000-0000-0000-0000-000000000305',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-612',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-14 10:00:00 +00:00',
        '2025-01-14 10:00:00 +00:00',
        false,
        'Single message',
        'Single Subject',
        '2025-01-14 09:00:00 +00:00',
        '2025-01-14 09:30:00 +00:00');

------------------------------------------------------------
-- Thread 6: Mix with some messages having sent_at and some not
-- Non-drafts with sent_at should take precedence
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000306',
        '00000000-0000-0000-0000-00000000001c',
        true, false, NOW(), NOW());

-- Non-draft without sent_at (earliest updated_at)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0613',
        '00000000-0000-0000-0000-000000000306',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-613',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-15 08:00:00 +00:00',
        NULL,
        false,
        'No sent_at',
        'Partial Sent Subject',
        '2025-01-15 07:00:00 +00:00',
        '2025-01-15 07:20:00 +00:00');

-- Non-draft with sent_at (should determine first_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0614',
        '00000000-0000-0000-0000-000000000306',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-614',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-15 10:00:00 +00:00',
        '2025-01-15 10:00:00 +00:00',
        false,
        'With sent_at',
        'Partial Sent Subject',
        '2025-01-15 09:00:00 +00:00',
        '2025-01-15 09:30:00 +00:00');

-- Non-draft with sent_at (should determine last_message_ts)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0615',
        '00000000-0000-0000-0000-000000000306',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-615',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-15 12:00:00 +00:00',
        '2025-01-15 12:00:00 +00:00',
        false,
        'Latest with sent_at',
        'Partial Sent Subject',
        '2025-01-15 11:00:00 +00:00',
        '2025-01-15 11:30:00 +00:00');

-- Non-draft without sent_at (latest updated_at, but should be ignored)
INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            sent_at, is_draft, snippet, subject, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000e0616',
        '00000000-0000-0000-0000-000000000306',
        '00000000-0000-0000-0000-00000000001c',
        'provider-msg-616',
        FALSE,
        '00000000-0000-0000-0000-0000000c0020',
        '2025-01-15 15:00:00 +00:00',
        NULL,
        false,
        'Latest no sent_at',
        'Partial Sent Subject',
        '2025-01-15 14:00:00 +00:00',
        '2025-01-15 14:30:00 +00:00');

------------------------------------------------------------
-- Add user history for some threads (for viewed_at testing)
------------------------------------------------------------

INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000001c',
        '00000000-0000-0000-0000-000000000301',
        NOW(),
        '2025-01-10 13:00:00 +00:00');