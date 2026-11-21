-- The keys of the viewer's lists each requested contact is in, in request
-- order. A contact in none (including the viewer, who is never their own
-- teammate) is left out. $1 viewer, $2 canonical requested ids (at most 500,
-- deduplicated), $3 the teammates list key.
-- Each id is two index range reads over its few rows; the roster is read once.
WITH teammates AS MATERIALIZED (
    SELECT lower(teammate.user_id COLLATE "C") AS id
    FROM team_user AS own
    JOIN team_user AS teammate ON teammate.team_id = own.team_id
    WHERE own.user_id IN (
        -- team_user may hold a legacy mixed-case id for this user. Find
        -- it through the lower(email) index and keep it only if it folds
        -- to the canonical id.
        SELECT $1::text
        UNION
        SELECT account.id
        FROM "User" AS account
        WHERE lower(account.email) = substr($1, length('macro|') + 1)
          AND lower(account.id COLLATE "C") = $1
    )
)
SELECT
    requested.contact AS "contact!",
    array_agg(DISTINCT listed.list_key ORDER BY listed.list_key) AS "lists!"
FROM unnest($2::text[]) WITH ORDINALITY AS requested (contact, ordinal)
CROSS JOIN LATERAL (
    SELECT list_key
    FROM contact_list_members
    WHERE user_id = $1 AND contact_user_id = requested.contact
    UNION ALL
    SELECT list_key
    FROM contact_inbox_members
    WHERE user_id = $1 AND contact_user_id = requested.contact
    UNION ALL
    SELECT $3::text
    WHERE requested.contact <> $1
      AND requested.contact COLLATE "C" IN (SELECT id FROM teammates)
) AS listed
GROUP BY requested.ordinal, requested.contact
ORDER BY requested.ordinal
