-- Profile names for the requested ids, falling back to the viewer's address book.
-- $1 viewer id, $2 requested ids.
-- The viewer's mailboxes are read once, into an array, and contacts are probed
-- by (link_id, email_address). Joined to email_links per requested id instead,
-- that table's statistics decide the plan: when they say most mailboxes are the
-- viewer's (as when it was analyzed while one account owned its rows), Postgres
-- stops reading through the viewer's mailboxes and searches every mailbox's
-- contacts for the address through the trigram index, which takes seconds for
-- one page of ids.
WITH viewer_mailboxes AS MATERIALIZED (
    SELECT COALESCE(array_agg(id), '{}'::uuid[]) AS ids
    FROM email_links
    WHERE macro_id = $1
),
requested_ids AS (
    SELECT DISTINCT id
    FROM UNNEST($2::text[]) AS requested(id)
)
SELECT
    req.id as "user_profile_id!",
    CASE
        WHEN NULLIF(mui.first_name, 'N/A') IS NOT NULL
          OR NULLIF(mui.last_name, 'N/A') IS NOT NULL
        THEN NULLIF(mui.first_name, 'N/A')
        ELSE SPLIT_PART(contact.name, ' ', 1)
    END as "first_name",
    CASE
        WHEN NULLIF(mui.first_name, 'N/A') IS NOT NULL
          OR NULLIF(mui.last_name, 'N/A') IS NOT NULL
        THEN NULLIF(mui.last_name, 'N/A')
        ELSE CASE
            WHEN POSITION(' ' IN contact.name) > 0
            THEN NULLIF(TRIM(SUBSTRING(contact.name FROM POSITION(' ' IN contact.name) + 1)), '')
            ELSE NULL
        END
    END as "last_name",
    COALESCE(u."isAgent", FALSE) as "is_agent!"
FROM requested_ids req
LEFT JOIN "User" u ON u.id = req.id
LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
LEFT JOIN LATERAL (
    SELECT ec.name
    FROM email_contacts ec
    WHERE ec.link_id = ANY((SELECT ids FROM viewer_mailboxes)::uuid[])
      AND ec.email_address = REPLACE(req.id, 'macro|', '')
      AND ec.name IS NOT NULL
      AND NULLIF(mui.first_name, 'N/A') IS NULL
      AND NULLIF(mui.last_name, 'N/A') IS NULL
    LIMIT 1
) contact ON TRUE
WHERE u.id IS NOT NULL OR contact.name IS NOT NULL
