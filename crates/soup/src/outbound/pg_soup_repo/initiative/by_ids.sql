
        WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL SELECT team_id::text FROM team_user WHERE user_id = $1
            UNION ALL SELECT $1
        )
        SELECT i.id, i.name, i.owner_user_id, i.description_document_id,
            i.created_at, i.updated_at, uh."updatedAt"::timestamptz AS viewed_at
        FROM initiative i
        LEFT JOIN "UserHistory" uh ON uh."itemId" = i.id::text
            AND uh."itemType" = 'initiative' AND uh."userId" = $1
        WHERE i.id = ANY($2) AND (
            EXISTS (SELECT 1 FROM entity_access ea
                WHERE ea.entity_id = i.id AND ea.entity_type = 'initiative'
                AND ea.source_id IN (SELECT source_id FROM user_source_ids))
            OR EXISTS (SELECT 1 FROM "SharePermission" sp
                JOIN team_user owner_team ON owner_team.user_id = i.owner_user_id
                WHERE sp.id = i.share_permission_id AND sp."linkShare" = 'TEAM'
                AND owner_team.team_id::text IN (SELECT source_id FROM user_source_ids))
        )
        