SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM (
    SELECT * FROM (
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
              AND (m.import_order, m.created_at, m.id) < ($4, $5, $6)
            ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
            OFFSET 0
        ) key
        WHERE $4::bigint IS NOT NULL AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order DESC NULLS FIRST, key.created_at DESC, key.id DESC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
            ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
            OFFSET 0
        ) key
        WHERE $7::boolean AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order DESC NULLS FIRST, key.created_at DESC, key.id DESC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NULL
              AND (m.created_at, m.id) < ($8, $9)
            ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
            OFFSET 0
        ) key
        WHERE $8::timestamptz IS NOT NULL AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order DESC NULLS FIRST, key.created_at DESC, key.id DESC
        LIMIT $11)
        UNION ALL
        (SELECT key.id, key.import_order, key.created_at FROM (
            SELECT m.id, m.import_order, m.created_at FROM comms_messages m
            WHERE m.thread_id = $3 AND m.import_order IS NULL
            ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
            OFFSET 0
        ) key
        WHERE $10::boolean AND EXISTS (
            SELECT 1 FROM comms_messages scope
            WHERE scope.id = key.id AND scope.parent_entity_type = $1
              AND scope.parent_entity_id = $2 AND scope.deleted_at IS NULL
            OFFSET 0
        )
        ORDER BY key.import_order DESC NULLS FIRST, key.created_at DESC, key.id DESC
        LIMIT $11)
    ) positions
    ORDER BY positions.import_order DESC NULLS FIRST, positions.created_at DESC, positions.id DESC
    LIMIT $11
) page
JOIN comms_messages m ON m.id = page.id
ORDER BY page.import_order DESC NULLS FIRST, page.created_at DESC, page.id DESC
