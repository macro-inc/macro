-- Multiple GitHub senders share one address-book contact. The message's
-- From display name must win over that contact's cached name.
UPDATE email_contacts
SET email_address = 'notifications@github.com', name = 'Cached contact name'
WHERE id = '40000001-0000-0000-0000-000000000001';

UPDATE email_messages
SET from_name = CASE id
    WHEN '30000001-0000-0000-0000-000000000001' THEN 'Sean Aye'
    WHEN '30000002-0000-0000-0000-000000000002' THEN 'Sent author'
    WHEN '30000003-0000-0000-0000-000000000003' THEN 'Draft author'
    WHEN '30000005-0000-0000-0000-000000000005' THEN 'cursor[bot]'
END
WHERE id IN (
    '30000001-0000-0000-0000-000000000001',
    '30000002-0000-0000-0000-000000000002',
    '30000003-0000-0000-0000-000000000003',
    '30000005-0000-0000-0000-000000000005'
);
