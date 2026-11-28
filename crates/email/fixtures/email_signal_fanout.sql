INSERT INTO email_contacts (id, link_id, email_address)
SELECT md5('fanout-contact:' || size)::uuid,
       '00000000-0000-0000-0000-000000000e01',
       'fanout-' || size || '@example.com'
FROM (VALUES (50), (100), (300)) fixtures(size);

INSERT INTO email_threads (id, link_id, provider_id, is_signal)
SELECT md5('fanout-thread:' || size || ':' || n)::uuid,
       '00000000-0000-0000-0000-000000000e01',
       'fixture-' || size || '-' || n,
       true
FROM (VALUES (50), (100), (300)) fixtures(size)
CROSS JOIN LATERAL generate_series(1, size) n;

INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, mailbox_state)
SELECT md5('fanout-message:' || size || ':' || n)::uuid,
       md5('fanout-thread:' || size || ':' || n)::uuid,
       '00000000-0000-0000-0000-000000000e01',
       md5('fanout-contact:' || size)::uuid,
       '{"in_trash": false, "attention": "primary"}'::jsonb
FROM (VALUES (50), (100), (300)) fixtures(size)
CROSS JOIN LATERAL generate_series(1, size) n;
