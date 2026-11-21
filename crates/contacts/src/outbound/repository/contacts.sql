-- The viewer's whole legacy directory, without self. A legacy edge says
-- nothing about direction, so the directed lists decide, as in page.sql: a
-- peer is left out when only the peer has the viewer (the peer's inbox or
-- invite) and nothing says the viewer has the peer (no list or inbox row of
-- the viewer's, not a teammate). Edges no list explains stay.
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
    AND NOT EXISTS (
        SELECT 1
        FROM team_user AS own
        JOIN team_user AS teammate ON teammate.team_id = own.team_id
        WHERE own.user_id = $1 AND teammate.user_id = neighbors.contact
    )
)
