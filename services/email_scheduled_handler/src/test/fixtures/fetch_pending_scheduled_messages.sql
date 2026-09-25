-- SQL fixture for fetch_pending_scheduled_messages tests
-- Tests fetching scheduled messages that are ready to be sent

------------------------------------------------------------
-- User Links
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01', 'macro|pending_user@example.com', '00000000-0000-0000-0000-000000000f01',
        'pending_user@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f02', 'macro|other_pending_user@example.com', '00000000-0000-0000-0000-000000000f02',
        'other_pending_user@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf001',
        '00000000-0000-0000-0000-000000000f01',
        'sender@example.com',
        NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cf002',
        '00000000-0000-0000-0000-000000000f02',
        'other_sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Threads
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        true, false, NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f202',
        '00000000-0000-0000-0000-000000000f02',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Message 1: Draft with past send_time, not sent (SHOULD BE RETURNED)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f501',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-pending-501',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-10 10:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01',
        '00000000-0000-0000-0000-00000000f501',
        '2020-01-01 10:00:00 +00:00',  -- Past date
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 2: Draft with future send_time, not sent (SHOULD NOT BE RETURNED)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f502',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-pending-502',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-10 11:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01',
        '00000000-0000-0000-0000-00000000f502',
        '2099-12-31 23:59:59 +00:00',  -- Future date
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 3: Draft with past send_time, already sent (SHOULD NOT BE RETURNED)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f503',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-pending-503',
        FALSE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-10 12:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01',
        '00000000-0000-0000-0000-00000000f503',
        '2020-01-01 12:00:00 +00:00',  -- Past date
        true,  -- Already sent
        NOW(), NOW());

------------------------------------------------------------
-- Message 4: NOT a draft (is_draft = false) with past send_time, not sent (SHOULD NOT BE RETURNED)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f504',
        '00000000-0000-0000-0000-00000000f201',
        '00000000-0000-0000-0000-000000000f01',
        'provider-pending-504',
        TRUE,
        '00000000-0000-0000-0000-0000000cf001',
        '2025-01-10 13:00:00 +00:00',
        false, false, false, false, NOW(), NOW());  -- is_draft = false

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f01',
        '00000000-0000-0000-0000-00000000f504',
        '2020-01-01 13:00:00 +00:00',  -- Past date
        false,
        NOW(), NOW());

------------------------------------------------------------
-- Message 5: Another draft with past send_time from different link (SHOULD BE RETURNED)
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f505',
        '00000000-0000-0000-0000-00000000f202',
        '00000000-0000-0000-0000-000000000f02',
        'provider-pending-505',
        FALSE,
        '00000000-0000-0000-0000-0000000cf002',
        '2025-01-10 14:00:00 +00:00',
        false, false, false, true, NOW(), NOW());

INSERT INTO email_scheduled_messages (link_id, message_id, send_time, sent, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000f02',
        '00000000-0000-0000-0000-00000000f505',
        '2020-01-01 14:00:00 +00:00',  -- Past date
        false,
        NOW(), NOW());