-- Only the final message introduces the blocked participant. Inclusion is
-- already satisfied by the first message, so its early match must not stop
-- the shared participant set before the exclusion reader finishes it.
INSERT INTO email_contacts (id, link_id, email_address) VALUES
('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000011', 'participant@private.example');

INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, is_sent, is_draft, internal_date_ts, global_id)
SELECT ('018f0000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-4000-8000-000000000021',
       '00000000-0000-4000-8000-000000000011',
       '00000000-0000-4000-8000-000000000031',
       TRUE, FALSE, '2026-01-03'::timestamptz + n * interval '1 second',
       'long-thread-' || n || '@example.com'
FROM generate_series(1, 1000) n;

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT ('018f0000-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
       CASE WHEN n = 1000 THEN '00000000-0000-4000-8000-000000000037'::uuid
            ELSE '00000000-0000-4000-8000-000000000031'::uuid END,
       'TO'::email_recipient_type
FROM generate_series(1, 1000) n;
