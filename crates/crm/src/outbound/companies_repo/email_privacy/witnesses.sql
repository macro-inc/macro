-- Exactly two expected witnesses. Identical first/last IDs are valid.
SELECT count(*) = 2 AS "valid!"
FROM (VALUES
    ($3::uuid, $4::uuid, $5::timestamptz, $6::boolean, $7::uuid),
    ($8::uuid, $9::uuid, $10::timestamptz, $11::boolean, $12::uuid)
) expected(message_id, thread_id, occurred_at, is_sent, contact_id)
JOIN LATERAL (
    SELECT id, link_id, thread_id, is_sent, is_draft, mailbox_state,
           COALESCE(internal_date_ts, created_at) AS occurred_at, from_contact_id
    FROM email_messages WHERE id = expected.message_id OFFSET 0
) m ON TRUE
JOIN LATERAL (
    SELECT id, link_id, email_address
    FROM email_contacts WHERE id = expected.contact_id OFFSET 0
) contact ON TRUE
WHERE m.link_id = $1 AND m.thread_id = expected.thread_id
  AND m.is_sent = expected.is_sent AND m.occurred_at = expected.occurred_at
  AND NOT m.is_draft
  AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
  AND contact.link_id = $1 AND lower(contact.email_address) = $2
  AND CASE WHEN m.is_sent THEN EXISTS (
      SELECT 1 FROM email_message_recipients recipient
      WHERE recipient.message_id = m.id AND recipient.contact_id = contact.id
  ) ELSE m.from_contact_id = contact.id END
