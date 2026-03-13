-- One-off backfill script for email_contact_search_index
-- Run manually after the 20260311180000 migration has been applied
-- Safe to re-run (ON CONFLICT DO NOTHING)

-- Backfill: FROM contacts
INSERT INTO email_contact_search_index
    (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
SELECT m.link_id, m.thread_id, m.id, COALESCE(m.from_name, c.name), c.email_address, 'FROM'
FROM email_messages m
JOIN email_contacts c ON c.id = m.from_contact_id
ON CONFLICT (message_id, contact_email, contact_type) DO NOTHING;

-- Backfill: TO/CC/BCC contacts
INSERT INTO email_contact_search_index
    (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
SELECT m.link_id, m.thread_id, m.id, COALESCE(mr.name, c.name), c.email_address, mr.recipient_type::text
FROM email_message_recipients mr
JOIN email_messages m ON m.id = mr.message_id
JOIN email_contacts c ON c.id = mr.contact_id
ON CONFLICT (message_id, contact_email, contact_type) DO NOTHING;
