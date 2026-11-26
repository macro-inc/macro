SELECT r.thread_id
FROM selected_threads r
UNION ALL
SELECT m.thread_id
FROM selected_email_contacts ec
CROSS JOIN LATERAL (
    SELECT thread_id FROM email_messages
    WHERE from_contact_id = ec.id AND NOT is_draft
    OFFSET 0
) m
UNION ALL
SELECT m.thread_id
FROM selected_email_contacts ec
CROSS JOIN LATERAL (
    SELECT message_id FROM email_message_recipients WHERE contact_id = ec.id OFFSET 0
) r
CROSS JOIN LATERAL (
    SELECT thread_id FROM email_messages
    WHERE id = r.message_id AND link_id = ec.link_id AND NOT is_draft
    OFFSET 0
) m
