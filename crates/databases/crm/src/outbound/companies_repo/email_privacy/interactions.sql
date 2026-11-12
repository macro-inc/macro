WITH matching_messages AS (
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at) AS occurred_at
    FROM email_messages m
    JOIN email_message_recipients r ON r.message_id = m.id
    JOIN email_contacts ec ON ec.id = r.contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
    UNION
    SELECT m.id, m.thread_id, m.is_sent, COALESCE(m.internal_date_ts, m.created_at)
    FROM email_messages m
    JOIN email_contacts ec ON ec.id = m.from_contact_id
    WHERE m.link_id = $2 AND ec.link_id = $2 AND NOT m.is_sent AND NOT m.is_draft AND lower(ec.email_address) = $3
), thread_interactions AS MATERIALIZED (
    -- Evaluate whole-thread privacy once per conversation, not per message.
    SELECT thread_id,
           min(occurred_at) FILTER (WHERE is_sent) AS first_sent_at,
           min(occurred_at) AS first_at,
           max(occurred_at) AS last_at,
           bool_or(is_sent) AS is_sent
    FROM matching_messages
    GROUP BY thread_id
)
SELECT COALESCE(min(first_sent_at), min(first_at)) AS first_at,
       max(last_at) AS last_at, bool_or(is_sent) AS is_sent
FROM thread_interactions
WHERE crm_email_thread_allowed($1, thread_id)
