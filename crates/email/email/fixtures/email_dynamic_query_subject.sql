-- Subject filter fixture. Layers on top of `email_dynamic_query`.
--
-- Subject("fyi") matches:
--   Thread 1 — john's own message "FYI: board deck"
--   Thread 6 — "fwd: fyi q3 numbers" (lower case)
--   Thread 5 — only jane's follow-up message 5b; john's message is not FYI
-- Subject("100%") matches thread 4 ("100% done") but not thread 8 ("1000 seats").
-- Thread 7's message has no subject.

UPDATE email_messages SET subject = 'FYI: board deck'
WHERE id = '30000001-0000-0000-0000-000000000001';
UPDATE email_messages SET subject = 'fwd: fyi q3 numbers'
WHERE id = '30000006-0000-0000-0000-000000000006';
UPDATE email_messages SET subject = '100% done'
WHERE id = '30000004-0000-0000-0000-000000000004';
UPDATE email_messages SET subject = '1000 seats'
WHERE id = '30000008-0000-0000-0000-000000000008';
UPDATE email_messages SET subject = NULL
WHERE id = '30000007-0000-0000-0000-000000000007';

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    ('30000005-0000-0000-0000-0000000000b5', '20000005-0000-0000-0000-000000000005',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg5b', '40000002-0000-0000-0000-000000000002',
     'FYI follow-up', 'Following up', '2024-01-11 07:00:00+00',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES ('30000005-0000-0000-0000-0000000000b5', '10000001-0000-0000-0000-000000000001');
