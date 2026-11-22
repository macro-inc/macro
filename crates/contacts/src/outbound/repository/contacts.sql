-- The viewer's whole legacy directory, without self: the other end of each
-- edge and the current team. Team joins no longer write edges, so teammates
-- come from team_user, folded like the list-aware directory.
--
-- A legacy edge says nothing about direction, so the directed lists decide,
-- as in page.sql. Edges no list explains stay. A teammate
-- with an edge comes back twice; the caller drops repeats, which is cheaper
-- than a UNION's locale sort of the whole directory.
WITH
-- Peers only the peer has: their inbox or invite names the viewer, and no list
-- or inbox row of the viewer's names them. Read once from the viewer's own
-- list rows and the rows naming the viewer (contact_idx, primary keys), so its
-- cost follows those lists, not the directory's size.
hidden AS MATERIALIZED (
    (
        SELECT user_id AS id FROM contact_inbox_members
        WHERE contact_user_id = lower($1 COLLATE "C")
        UNION
        SELECT user_id FROM contact_list_members
        WHERE contact_user_id = lower($1 COLLATE "C") AND list_key = 'invited'
    )
    EXCEPT
    (
        SELECT contact_user_id FROM contact_list_members
        WHERE user_id = lower($1 COLLATE "C")
        UNION
        SELECT contact_user_id FROM contact_inbox_members
        WHERE user_id = lower($1 COLLATE "C")
    )
)
SELECT neighbors.contact
FROM (
    SELECT user1 AS contact FROM contacts_connections WHERE user2 = $1
    UNION ALL
    SELECT user2 AS contact FROM contacts_connections WHERE user1 = $1
) AS neighbors
-- NOT EXISTS, not NOT IN: an anti-join can spill to disk, while a NOT IN
-- subplan too big for hash_mem is rescanned once per contact.
WHERE NOT EXISTS (
    SELECT 1 FROM hidden WHERE hidden.id = lower(neighbors.contact COLLATE "C")
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
