-- Additional fixture data for EmailLiteral::Importance tests that rely on email_filters.
-- This script is intended to be layered on top of email_dynamic_query.sql.

INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('40000005-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sam@alerts.test', 'Sam Alerts', NOW(), NOW()),
    ('40000006-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'blocked@alerts.test', 'Blocked Alerts', NOW(), NOW()),
    ('40000007-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'guest@mail.test', 'Guest Mail', NOW(), NOW()),
    ('40000008-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vip@mail.test', 'VIP Mail', NOW(), NOW());

INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('20000012-0000-0000-0000-000000000012', 'thread12', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-04 00:00:00+00', NOW(), NOW()),
    ('20000013-0000-0000-0000-000000000013', 'thread13', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-03 00:00:00+00', NOW(), NOW()),
    ('20000014-0000-0000-0000-000000000014', 'thread14', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-02 00:00:00+00', NOW(), NOW()),
    ('20000015-0000-0000-0000-000000000015', 'thread15', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-01 00:00:00+00', NOW(), NOW()),
    ('20000016-0000-0000-0000-000000000016', 'thread16', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2023-12-31 00:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('30000012-0000-0000-0000-000000000012', '20000012-0000-0000-0000-000000000012',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg12', '40000005-0000-0000-0000-000000000005',
     'Alerts Promotion', 'Should become important via domain rule', '2024-01-04 00:00:00+00',
     false, false, false, false, NOW(), NOW()),
    ('30000013-0000-0000-0000-000000000013', '20000013-0000-0000-0000-000000000013',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg13', '40000006-0000-0000-0000-000000000006',
     'Blocked Alerts Update', 'Should stay unimportant via address override', '2024-01-03 00:00:00+00',
     false, false, false, false, NOW(), NOW()),
    ('30000014-0000-0000-0000-000000000014', '20000014-0000-0000-0000-000000000014',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg14', '40000007-0000-0000-0000-000000000007',
     'Guest Mail', 'Should become not-important via domain rule', '2024-01-02 00:00:00+00',
     false, false, false, false, NOW(), NOW()),
    ('30000015-0000-0000-0000-000000000015', '20000015-0000-0000-0000-000000000015',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg15', '40000008-0000-0000-0000-000000000008',
     'VIP Mail', 'Should stay important via address override', '2024-01-01 00:00:00+00',
     false, false, false, false, NOW(), NOW()),
    ('30000016-0000-0000-0000-000000000016', '20000016-0000-0000-0000-000000000016',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg16', '40000005-0000-0000-0000-000000000005',
     'Trashed Alerts Promotion', 'Should not become important because it is trashed', '2023-12-31 00:00:00+00',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('30000012-0000-0000-0000-000000000012', '10000010-0000-0000-0000-000000000010'),
    ('30000013-0000-0000-0000-000000000013', '10000009-0000-0000-0000-000000000009'),
    ('30000016-0000-0000-0000-000000000016', '10000010-0000-0000-0000-000000000010'),
    ('30000016-0000-0000-0000-000000000016', '10000006-0000-0000-0000-000000000006');

INSERT INTO email_filters (link_id, email_domain, is_important, created_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alerts.test', true, NOW()),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mail.test', false, NOW());

INSERT INTO email_filters (link_id, email_address, is_important, created_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'blocked@alerts.test', false, NOW()),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vip@mail.test', true, NOW());
