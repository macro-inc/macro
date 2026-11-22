-- Delete each named pair, whichever end is stored first and in whatever ASCII
-- case a legacy row spelled the other end. $1 and $2 are the pairs' ends, at
-- most 500. Each pair is four probes of the scoped case-folding peer indexes
-- (idx_contacts_connections_user1_peer_ci, idx_contacts_connections_user2_peer_ci),
-- keyed on one end's canonical id. A row spelling both ends in another case
-- is not found; legacy writers stored the joining ids as given.
--
-- A pair an inbox or invite still explains, in either direction, keeps its
-- edge: the readers decide its direction from those rows, and deleting it
-- would drop a contact the viewer really has. `interacted` rows do not keep
-- it, since team channels wrote them for teammates.
WITH removed AS (
    -- Back to the default collation, the key columns' own, or no index on
    -- user1 or user2 can serve the equality probes below.
    SELECT DISTINCT
        lower(first COLLATE "C") COLLATE "default" AS first,
        lower(second COLLATE "C") COLLATE "default" AS second
    FROM unnest($1::text[], $2::text[]) AS pair (first, second)
    WHERE lower(first COLLATE "C") <> lower(second COLLATE "C")
),
unexplained AS (
    SELECT removed.first, removed.second
    FROM removed
    WHERE NOT EXISTS (
        SELECT 1 FROM contact_inbox_members AS inbox
        WHERE (inbox.user_id = removed.first COLLATE "C" AND inbox.contact_user_id = removed.second COLLATE "C")
           OR (inbox.user_id = removed.second COLLATE "C" AND inbox.contact_user_id = removed.first COLLATE "C")
    )
      AND NOT EXISTS (
        SELECT 1 FROM contact_list_members AS invite
        WHERE invite.list_key = 'invited'
          AND (
              (invite.user_id = removed.first COLLATE "C" AND invite.contact_user_id = removed.second COLLATE "C")
              OR (invite.user_id = removed.second COLLATE "C" AND invite.contact_user_id = removed.first COLLATE "C")
          )
    )
)
DELETE FROM contacts_connections
WHERE id IN (
    SELECT edge.id
    FROM unexplained AS removed
    CROSS JOIN LATERAL (
        SELECT id FROM contacts_connections
        WHERE user1 = removed.first
          AND lower(user2 COLLATE "C") = removed.second
          AND user2 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT id FROM contacts_connections
        WHERE user2 = removed.first
          AND lower(user1 COLLATE "C") = removed.second
          AND user1 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT id FROM contacts_connections
        WHERE user1 = removed.second
          AND lower(user2 COLLATE "C") = removed.first
          AND user2 COLLATE "C" LIKE 'macro|%'
        UNION ALL
        SELECT id FROM contacts_connections
        WHERE user2 = removed.second
          AND lower(user1 COLLATE "C") = removed.first
          AND user1 COLLATE "C" LIKE 'macro|%'
    ) AS edge
)
