-- The archived calls $1 can see, narrowed to the viewer-relative statuses in
-- $2 when it is not empty.
--
-- A call is visible through a grant held by one of the caller's sources (a
-- standalone call only through the caller's own user grant), or, in a
-- channel, through a public link share or a team link share whose owner is
-- in one of the caller's teams.
--
-- Grants are read by source, so that part costs what the caller holds. The
-- link shares are checked with one share permission probe per channel call:
-- a public call is visible to everyone, so no grant leads to it. OFFSET 0
-- fences keep both parts to lookups by key, never a join that compares every
-- grant with every source or scans "SharePermission".
WITH user_source_ids AS (
    SELECT cp.channel_id::text AS source_id
    FROM comms_channel_participants cp
    WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL
    SELECT t.team_id::text
    FROM team_user t
    WHERE t.user_id = $1
    UNION ALL
    SELECT $1
),
granted AS (
    SELECT DISTINCT held.entity_id
    FROM (
        SELECT ea.entity_id
        FROM entity_access ea
        WHERE ea.source_id = ANY(ARRAY(SELECT source_id FROM user_source_ids))
            AND ea.entity_type = 'call'
        OFFSET 0
    ) held
),
visible AS (
    SELECT cr.id, cr.channel_id
    FROM granted g
    CROSS JOIN LATERAL (
        SELECT cr.id, cr.channel_id
        FROM call_records cr
        WHERE cr.id = g.entity_id
            AND (
                cr.channel_id IS NOT NULL
                OR EXISTS (
                    SELECT 1
                    FROM entity_access own
                    WHERE own.source_id = $1
                        AND own.entity_type = 'call'
                        AND own.entity_id = cr.id
                        AND own.source_type = 'user'
                )
            )
        OFFSET 0
    ) cr
    UNION
    SELECT cr.id, cr.channel_id
    FROM call_records cr
    CROSS JOIN LATERAL (
        SELECT 1
        FROM "SharePermission" sp
        WHERE sp.id = cr.share_permission_id
            AND sp."linkShareAccessLevel" IS NOT NULL
            AND (
                sp."linkShare" = 'PUBLIC'
                OR (
                    sp."linkShare" = 'TEAM'
                    AND EXISTS (
                        SELECT 1
                        FROM team_user owner_team
                        WHERE owner_team.user_id = cr.created_by
                            AND owner_team.team_id::text = ANY(ARRAY(SELECT source_id FROM user_source_ids))
                    )
                )
            )
        OFFSET 0
    ) link_shared
    WHERE cr.channel_id IS NOT NULL
)
-- Status is worked out only when a filter asks for it.
SELECT v.id AS "id!"
FROM visible v
WHERE cardinality($2::text[]) = 0
    OR CASE
        WHEN EXISTS (
            SELECT 1
            FROM call_record_participants crp
            WHERE crp.call_record_id = v.id AND crp.user_id = $1
        ) THEN 'ATTENDED'
        WHEN EXISTS (
            SELECT 1
            FROM comms_channel_participants ccp
            WHERE ccp.channel_id = v.channel_id
                AND ccp.user_id = $1
                AND ccp.left_at IS NULL
        ) THEN 'MISSED'
        ELSE 'UNATTENDED'
    END = ANY($2)
