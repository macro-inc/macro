WITH user_source_ids AS (
    SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
    WHERE cp.user_id = $1 AND cp.left_at IS NULL
    UNION ALL SELECT team_id::text FROM team_user WHERE user_id = $1
    UNION ALL SELECT $1
)
SELECT r.id, r.table_id, row_table.database_id, r.position, r.created_by,
    row_database.user_id AS owner_id, r.created_at, r.updated_at
FROM database_rows r
JOIN database_tables row_table ON row_table.id = r.table_id
JOIN database_entity row_database ON row_database.database_id = row_table.database_id
WHERE r.id = ANY($2)
    AND row_database.trashed_at IS NULL
    AND EXISTS (SELECT 1 FROM entity_access ea
        WHERE ea.entity_id = row_database.database_id AND ea.entity_type = 'database'
        AND ea.source_id IN (SELECT source_id FROM user_source_ids))
ORDER BY r.created_at DESC, r.id DESC
