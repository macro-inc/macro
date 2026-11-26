-- One page of the users who have the subject in their directory: owners of a
-- stored list or inbox row naming them, their teammates, and the subject, in
-- byte order after the cursor. $1 subject, $2 exclusive cursor (NULL on the
-- first page), $3 page size + 1.
-- The stored branches seek the (contact_user_id, user_id) indexes from the
-- cursor and stop after $3 distinct owners.
SELECT owner AS "owner!"
FROM (
    (
        SELECT DISTINCT user_id AS owner
        FROM contact_list_members
        WHERE contact_user_id = $1 AND user_id > COALESCE($2::text, '')
        ORDER BY user_id
        LIMIT $3
    )
    UNION
    (
        SELECT DISTINCT user_id
        FROM contact_inbox_members
        WHERE contact_user_id = $1 AND user_id > COALESCE($2::text, '')
        ORDER BY user_id
        LIMIT $3
    )
    UNION
    (
        -- Teammates is mutual: the subject's roster is everyone who has them.
        SELECT DISTINCT lower(teammate.user_id COLLATE "C")
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
          AND teammate.user_id COLLATE "C" LIKE 'macro|%'
          AND lower(teammate.user_id COLLATE "C") > COALESCE($2::text, '')
        ORDER BY 1
        LIMIT $3
    )
    UNION
    SELECT $1::text COLLATE "C" WHERE $1::text COLLATE "C" > COALESCE($2::text, '')
) AS audience
ORDER BY owner
LIMIT $3
