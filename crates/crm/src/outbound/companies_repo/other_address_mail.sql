-- Whether mailbox $1 has a message, sent to or received from, any of the
-- addresses in $2. Mirrors the per-address gate the email service runs
-- before a teardown.
SELECT EXISTS (
    SELECT 1
    FROM email_contacts ec
    WHERE ec.link_id = $1
      AND LOWER(ec.email_address) = ANY($2::text[])
      AND (
          EXISTS (
              SELECT 1
              FROM email_message_recipients r
              JOIN email_messages m ON m.id = r.message_id
              WHERE r.contact_id = ec.id AND m.link_id = $1 AND m.is_sent
          )
          OR EXISTS (
              SELECT 1
              FROM email_messages m
              WHERE m.from_contact_id = ec.id AND m.link_id = $1 AND NOT m.is_sent
          )
      )
) AS "exists!"
