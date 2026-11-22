-- One page of the viewer's legacy directory: both directions of their edges,
-- their current team, their own inbox and invited rows, and self, in the
-- default collation's order after the cursor.
--
-- Keep the viewer as a scalar initplan. With a high-degree viewer, substituting
-- its literal into each branch can make Postgres scan a global ordering index
-- and discard unrelated edges instead of seeking the viewer's composite index.
-- Valid IDs are nonempty. An empty initial bound avoids a nullable OR turning
-- deep cursors into post-scan filters when a prepared statement uses a generic plan.
--
-- Team joins no longer write edges, so teammates come from team_user, like
-- the list-aware directory: ids folded to canonical lowercase and returned
-- in the default collation, so every branch and the cursor share one order.
--
-- A legacy edge says nothing about direction, so the directed lists decide:
-- a peer is hidden when only the peer has the viewer (the peer's inbox or
-- invite) and nothing says the viewer has the peer (no list or inbox row of
-- the viewer's, not a teammate). Edges no list explains stay visible. Hidden
-- rows still come back, flagged, so the cursor advances past them; the probes
-- run only for the page's rows, two primary-key reads each.
WITH viewer AS MATERIALIZED (SELECT $1::text AS id),
page AS MATERIALIZED (
    SELECT directory.contact, bool_or(directory.teammate) AS teammate
    FROM (
        (
            SELECT user1 AS contact, FALSE AS teammate
            FROM contacts_connections
            WHERE user2 = (SELECT id FROM viewer) AND user1 > COALESCE($2::text, '')
            ORDER BY user1
            LIMIT $3
        )
        UNION ALL
        (
            SELECT user2 AS contact, FALSE AS teammate
            FROM contacts_connections
            WHERE user1 = (SELECT id FROM viewer) AND user2 > COALESCE($2::text, '')
            ORDER BY user2
            LIMIT $3
        )
        UNION ALL
        (
            -- A user has at most one team, and its roster includes the
            -- viewer. The roster is read whole: no index orders it.
            SELECT DISTINCT lower(teammate.user_id COLLATE "C") COLLATE "default", TRUE
            FROM team_user AS own
            JOIN team_user AS teammate ON teammate.team_id = own.team_id
            WHERE own.user_id IN (
                -- team_user may hold a legacy mixed-case id for this user.
                -- Find it through the lower(email) index and keep it only if
                -- it folds to the canonical id.
                SELECT $1::text
                UNION
                SELECT account.id
                FROM "User" AS account
                WHERE lower(account.email) = substr($1, length('macro|') + 1)
                  AND lower(account.id COLLATE "C") = $1
            )
              AND teammate.user_id COLLATE "C" LIKE 'macro|%'
              AND lower(teammate.user_id COLLATE "C") COLLATE "default" > COALESCE($2::text, '')
            ORDER BY 1
            LIMIT $3
        )
        UNION ALL
        (
            -- The viewer's own inbox and invited rows: a contact the viewer
            -- really has stays listed after a team removal deletes its edge.
            -- The rows are C-collated; the default-collation expression
            -- indexes (contact_inbox_members_owner_default_order_idx,
            -- contact_list_members_invited_default_order_idx) let each branch
            -- range-read from the cursor in the page's order and stop at the
            -- limit. Keep the expressions as written so they match.
            SELECT DISTINCT (contact_user_id COLLATE "default"), FALSE
            FROM contact_inbox_members
            WHERE user_id = lower($1 COLLATE "C")
              AND (contact_user_id COLLATE "default") > COALESCE($2::text, '')
            ORDER BY 1
            LIMIT $3
        )
        UNION ALL
        (
            SELECT (contact_user_id COLLATE "default"), FALSE
            FROM contact_list_members
            WHERE user_id = lower($1 COLLATE "C")
              AND list_key = 'invited'
              AND (contact_user_id COLLATE "default") > COALESCE($2::text, '')
            ORDER BY 1
            LIMIT $3
        )
        UNION ALL
        SELECT $1::text, FALSE WHERE $1 > COALESCE($2::text, '')
    ) AS directory
    GROUP BY directory.contact
    ORDER BY directory.contact
    LIMIT $3
)
SELECT
    page.contact AS "contact!",
    (
        NOT page.teammate
        AND (
            EXISTS (
                SELECT 1 FROM contact_inbox_members AS theirs
                WHERE theirs.user_id = lower(page.contact COLLATE "C")
                  AND theirs.contact_user_id = lower($1 COLLATE "C")
            )
            OR EXISTS (
                SELECT 1 FROM contact_list_members AS theirs
                WHERE theirs.user_id = lower(page.contact COLLATE "C")
                  -- In the invited index's own expression, so both columns are index
                  -- conditions there (it would otherwise seek user_id and filter).
                  AND (theirs.contact_user_id COLLATE "default") = (lower($1 COLLATE "C") COLLATE "default")
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
    ) AS "hidden!"
FROM page
ORDER BY page.contact
