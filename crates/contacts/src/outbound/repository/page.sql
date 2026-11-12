-- Keep the viewer as a scalar initplan. With a high-degree viewer, substituting
-- its literal into each branch can make Postgres scan a global ordering index
-- and discard unrelated edges instead of seeking the viewer's composite index.
-- Valid IDs are nonempty. An empty initial bound avoids a nullable OR turning
-- deep cursors into post-scan filters when a prepared statement uses a generic plan.
WITH viewer AS MATERIALIZED (SELECT $1::text AS id)
SELECT contact AS "contact!"
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
