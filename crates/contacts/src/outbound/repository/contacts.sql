-- The viewer's whole legacy directory, without self: the other end of each
-- edge and the current team. Team joins no longer write edges, so teammates
-- come from team_user, folded like the list-aware directory.
--
-- A legacy edge says nothing about direction, so the directed lists decide,
-- as in page.sql: a peer is left out when only the peer has the viewer (the
-- peer's inbox or invite) and nothing says the viewer has the peer (no list
-- or inbox row of the viewer's). Edges no list explains stay. A teammate
-- with an edge comes back twice; the caller drops repeats, which is cheaper
-- than a UNION's locale sort of the whole directory.
SELECT neighbors.contact
FROM (
    SELECT user1 AS contact FROM contacts_connections WHERE user2 = $1
    UNION ALL
    SELECT user2 AS contact FROM contacts_connections WHERE user1 = $1
) AS neighbors
WHERE NOT (
    (
        EXISTS (
            SELECT 1 FROM contact_inbox_members AS theirs
            WHERE theirs.user_id = lower(neighbors.contact COLLATE "C")
              AND theirs.contact_user_id = lower($1 COLLATE "C")
        )
        OR EXISTS (
            SELECT 1 FROM contact_list_members AS theirs
            WHERE theirs.user_id = lower(neighbors.contact COLLATE "C")
              AND theirs.contact_user_id = lower($1 COLLATE "C")
              AND theirs.list_key = 'invited'
        )
    )
    AND NOT EXISTS (
        SELECT 1 FROM contact_list_members AS mine
        WHERE mine.user_id = lower($1 COLLATE "C")
          AND mine.contact_user_id = lower(neighbors.contact COLLATE "C")
    )
    AND NOT EXISTS (
        SELECT 1 FROM contact_inbox_members AS mine
        WHERE mine.user_id = lower($1 COLLATE "C")
          AND mine.contact_user_id = lower(neighbors.contact COLLATE "C")
    )
)
UNION ALL
-- A user has at most one team, and its roster includes the viewer.
SELECT lower(teammate.user_id COLLATE "C") COLLATE "default"
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
  AND lower(teammate.user_id COLLATE "C") <> lower($1 COLLATE "C")
