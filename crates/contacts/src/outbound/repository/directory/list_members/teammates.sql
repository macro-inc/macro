-- One page of the viewer's teammates, the viewer excluded, in byte order after
-- the cursor. $1 viewer, $2 exclusive cursor (NULL on the first page), $3 page
-- size + 1.
-- A user has at most one team. team_user ids may predate canonical lowercase
-- ids; fold them like the other directory reads. The roster is read whole: no
-- index orders it.
SELECT DISTINCT lower(teammate.user_id COLLATE "C") AS "contact!"
FROM team_user AS own
JOIN team_user AS teammate ON teammate.team_id = own.team_id
WHERE own.user_id IN (
    -- team_user may hold a legacy mixed-case id for this user. Find it
    -- through the lower(email) index and keep it only if it folds to the
    -- canonical id.
    SELECT $1::text
    UNION
    SELECT account.id
    FROM "User" AS account
    WHERE lower(account.email) = substr($1, length('macro|') + 1)
      AND lower(account.id COLLATE "C") = $1
)
  AND teammate.user_id COLLATE "C" LIKE 'macro|%'
  AND lower(teammate.user_id COLLATE "C") <> $1::text COLLATE "C"
  AND lower(teammate.user_id COLLATE "C") > COALESCE($2::text, '')
ORDER BY 1
LIMIT $3
