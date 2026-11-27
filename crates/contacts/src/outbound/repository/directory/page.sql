-- One page of the viewer's list-aware directory: every stored list, every inbox,
-- the current team, and the viewer, in byte order after the cursor.
-- $1 viewer, $2 exclusive cursor (NULL on the first page), $3 page size + 1.
-- Each branch seeks its own index from the cursor and stops after $3 distinct
-- contacts, so a page reads at most a few times $3 rows whatever the directory
-- size. COALESCE, not `$2 IS NULL OR`, keeps the cursor an index condition in
-- generic plans. A contact in several lists or inboxes appears once.
SELECT contact AS "contact!"
FROM (
    (
        SELECT DISTINCT contact_user_id AS contact
        FROM contact_list_members
        WHERE user_id = $1 AND contact_user_id > COALESCE($2::text, '')
        ORDER BY contact_user_id
        LIMIT $3
    )
    UNION
    (
        SELECT DISTINCT contact_user_id
        FROM contact_inbox_members
        WHERE user_id = $1 AND contact_user_id > COALESCE($2::text, '')
        ORDER BY contact_user_id
        LIMIT $3
    )
    UNION
    (
        -- A user has at most one team, and its roster includes the viewer.
        -- team_user ids may predate canonical lowercase ids; fold them like
        -- people search does. The roster is read whole: no index orders it.
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
) AS directory
ORDER BY contact
LIMIT $3
