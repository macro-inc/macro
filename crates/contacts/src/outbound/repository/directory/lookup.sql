-- The requested ids that are in the viewer's list-aware directory, in request
-- order. $1 viewer, $2 canonical requested ids (at most 500, deduplicated).
-- Each id is two primary-key point reads; the team roster is read once.
WITH teammates AS MATERIALIZED (
    SELECT lower(teammate.user_id COLLATE "C") AS id
    FROM team_user AS own
    JOIN team_user AS teammate ON teammate.team_id = own.team_id
    WHERE own.user_id = $1
)
SELECT requested.contact AS "contact!"
FROM unnest($2::text[]) WITH ORDINALITY AS requested (contact, ordinal)
-- At most one row per requested id, never a hashed subplan over the viewer's
-- whole directory.
LEFT JOIN LATERAL (
    SELECT TRUE AS present
    FROM contact_list_members
    WHERE user_id = $1 AND contact_user_id = requested.contact
    UNION ALL
    SELECT TRUE
    FROM contact_inbox_members
    WHERE user_id = $1 AND contact_user_id = requested.contact
    LIMIT 1
) AS stored ON TRUE
WHERE requested.contact = $1
   OR stored.present IS TRUE
   OR requested.contact COLLATE "C" IN (SELECT id FROM teammates)
ORDER BY requested.ordinal
