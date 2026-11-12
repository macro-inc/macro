-- Whether mailbox $2 still has a message, sent to or received from, any
-- address of contact $1 other than $3. Mirrors the per-address gate the
-- email service runs before a teardown.
SELECT EXISTS (
    SELECT 1
    FROM crm_contact_emails ce
    JOIN email_contacts ec
      ON ec.link_id = $2 AND LOWER(ec.email_address) = ce.email
    WHERE ce.contact_id = $1
      AND ce.email <> $3
      AND (
          EXISTS (
              SELECT 1
              FROM email_message_recipients r
              JOIN email_messages m ON m.id = r.message_id
              WHERE r.contact_id = ec.id AND m.link_id = $2 AND m.is_sent
          )
          OR EXISTS (
              SELECT 1
              FROM email_messages m
              WHERE m.from_contact_id = ec.id AND m.link_id = $2 AND NOT m.is_sent
          )
      )
) AS "exists!"
