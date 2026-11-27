-- One page of an owner's legacy contacts in both directions, as page.sql
-- reads them, and which of the owner's inboxes ($4) know each one: an
-- email_contacts row for the contact's address on that inbox
-- (idx_email_contacts_link_id_lower_email). Contacts no inbox knows still
-- come back, so the cursor advances past them.
WITH owner AS MATERIALIZED (SELECT $1::text AS id),
page AS (
    SELECT peer
    FROM (
        (
            SELECT user1 AS peer
            FROM contacts_connections
            WHERE user2 = (SELECT id FROM owner) AND user1 > $2
            ORDER BY user1
            LIMIT $3
        )
        UNION ALL
        (
            SELECT user2 AS peer
            FROM contacts_connections
            WHERE user1 = (SELECT id FROM owner) AND user2 > $2
            ORDER BY user2
            LIMIT $3
        )
    ) AS neighbors
    ORDER BY peer
    LIMIT $3
)
SELECT
    page.peer AS "peer!",
    ARRAY(
        SELECT inbox.id
        FROM unnest($4::uuid[]) AS inbox (id)
        WHERE page.peer COLLATE "C" LIKE 'macro|%'
          AND EXISTS (
              SELECT 1
              FROM email_contacts ec
              WHERE ec.link_id = inbox.id
                AND lower(ec.email_address::text) = lower(substr(page.peer, 7))
          )
    ) AS "link_ids!"
FROM page
ORDER BY page.peer
