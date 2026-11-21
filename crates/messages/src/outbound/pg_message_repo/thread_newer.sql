SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM (
    SELECT * FROM (
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
              AND (m.import_order, m.created_at, m.id) > ($4, $5, $6)
            ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
            OFFSET 0
        ) key
        WHERE $4::bigint IS NOT NULL AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order ASC NULLS LAST, key.created_at ASC, key.id ASC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
            ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
            OFFSET 0
        ) key
        WHERE $7::boolean AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order ASC NULLS LAST, key.created_at ASC, key.id ASC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NULL
              AND (m.created_at, m.id) > ($8, $9)
            ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
            OFFSET 0
        ) key
        WHERE $8::timestamptz IS NOT NULL AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order ASC NULLS LAST, key.created_at ASC, key.id ASC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NULL
            ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
            OFFSET 0
        ) key
        WHERE $10::boolean AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order ASC NULLS LAST, key.created_at ASC, key.id ASC
        LIMIT $11)
    ) positions
    ORDER BY positions.import_order ASC NULLS LAST, positions.created_at ASC, positions.id ASC
    LIMIT $11
) page
JOIN comms_messages m ON m.id = page.id
ORDER BY page.import_order ASC NULLS LAST, page.created_at ASC, page.id ASC
