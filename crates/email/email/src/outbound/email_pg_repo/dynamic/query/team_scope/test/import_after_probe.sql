WITH imported_threads AS (
    INSERT INTO email_threads (
        id, provider_id, link_id, inbox_visible, is_read,
        latest_inbound_message_ts, latest_non_spam_message_ts,
        created_at, updated_at
    )
    SELECT md5('snapshot-thread-' || i)::uuid, 'snapshot-import-' || i,
           $1, true, false, '2027-01-01'::timestamptz,
           '2027-01-01'::timestamptz, '2027-01-01'::timestamptz,
           '2027-01-01'::timestamptz
    FROM generate_series(1, 5001) i
    RETURNING id, provider_id, link_id, created_at
), imported_messages AS (
    INSERT INTO email_messages (
        id, provider_id, thread_id, link_id, internal_date_ts,
        from_contact_id, is_sent, is_draft, is_starred, is_read,
        created_at, updated_at
    )
    SELECT md5('snapshot-message-' || t.id)::uuid, t.provider_id,
           t.id, t.link_id, t.created_at, c.id, true, false, false,
           false, t.created_at, t.created_at
    FROM imported_threads t
    JOIN email_contacts c ON c.link_id = t.link_id
        AND c.email_address = 'u0@gamma.test'
    RETURNING id
)
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
SELECT m.id, c.id, 'TO'::email_recipient_type
FROM imported_messages m
JOIN email_contacts c ON c.link_id = $1 AND c.email_address = 'p0@sparse.test'
