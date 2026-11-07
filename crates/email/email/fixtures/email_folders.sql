INSERT INTO email_contacts (id, link_id, email_address, name) VALUES
    ('0d000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sender@example.com', 'Sender'),
    ('0d000000-0000-0000-0000-000000000002', '0a000000-0000-0000-0000-000000000001', 'sender@example.com', 'Sender');

UPDATE email_messages m SET from_contact_id = c.id
FROM email_contacts c
WHERE c.link_id = m.link_id AND c.email_address = 'sender@example.com'
    AND m.id::text LIKE '0c000000-%';
