-- Keep the viewer as a scalar initplan. With a high-degree viewer, substituting
-- its literal into each branch can make Postgres scan a global ordering index
-- and discard unrelated edges instead of seeking the viewer's composite index.
-- Valid IDs are nonempty. An empty initial bound avoids a nullable OR turning
-- deep cursors into post-scan filters when a prepared statement uses a generic plan.
--
-- A legacy edge says nothing about direction, so the directed lists decide:
-- a peer is hidden when only the peer has the viewer (the peer's inbox or
-- invite) and nothing says the viewer has the peer (no list or inbox row of
-- the viewer's, not a teammate). Edges no list explains stay visible. Hidden
-- rows still come back, flagged, so the cursor advances past them; the probes
-- run only for the page's rows, two primary-key reads each.
WITH viewer AS MATERIALIZED (SELECT $1::text AS id)
SELECT
    page.contact AS "contact!",
    (
        (
            EXISTS (
                SELECT 1 FROM contact_inbox_members AS theirs
                WHERE theirs.user_id = lower(page.contact COLLATE "C")
                  AND theirs.contact_user_id = lower($1 COLLATE "C")
            )
            OR EXISTS (
                SELECT 1 FROM contact_list_members AS theirs
                WHERE theirs.user_id = lower(page.contact COLLATE "C")
                  AND theirs.contact_user_id = lower($1 COLLATE "C")
                  AND theirs.list_key = 'invited'
            )
        )
        AND NOT EXISTS (
            SELECT 1 FROM contact_list_members AS mine
            WHERE mine.user_id = lower($1 COLLATE "C")
              AND mine.contact_user_id = lower(page.contact COLLATE "C")
        )
        AND NOT EXISTS (
            SELECT 1 FROM contact_inbox_members AS mine
            WHERE mine.user_id = lower($1 COLLATE "C")
              AND mine.contact_user_id = lower(page.contact COLLATE "C")
        )
        AND NOT EXISTS (
            SELECT 1
            FROM team_user AS own
            JOIN team_user AS teammate ON teammate.team_id = own.team_id
            WHERE own.user_id = $1 AND teammate.user_id = page.contact
        )
    ) AS "hidden!"
FROM (
    SELECT contact
    FROM (
        (
            SELECT user1 AS contact
            FROM contacts_connections
            WHERE user2 = (SELECT id FROM viewer) AND user1 > COALESCE($2::text, '')
            ORDER BY user1
            LIMIT $3
        )
        UNION ALL
        (
            SELECT user2 AS contact
            FROM contacts_connections
            WHERE user1 = (SELECT id FROM viewer) AND user2 > COALESCE($2::text, '')
            ORDER BY user2
            LIMIT $3
        )
        UNION ALL
        SELECT $1::text AS contact WHERE $1 > COALESCE($2::text, '')
    ) AS directory
    ORDER BY contact
    LIMIT $3
) AS page
ORDER BY page.contact
