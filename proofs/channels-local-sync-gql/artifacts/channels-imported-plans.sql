\pset pager off
SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';
SELECT version();
PREPARE thread_older(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM (
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
;
PREPARE thread_newer(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM (
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
;
PREPARE metadata(uuid[]) AS SELECT t.root_id, to_jsonb(t) AS "state!: Json<ThreadState>",
            (SELECT count(*) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL) AS "reply_count!",
            (SELECT max(created_at) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL) AS latest_reply_at
            FROM comms_message_threads t WHERE root_id = ANY($1);
PREPARE preview(uuid[]) AS SELECT to_jsonb(preview) AS "message!: Json<StoredMessage>"
            FROM unnest($1::uuid[]) root(id) CROSS JOIN LATERAL (
                SELECT r.* FROM comms_messages r WHERE r.thread_id = root.id AND r.deleted_at IS NULL
                ORDER BY r.import_order NULLS LAST, r.created_at, r.id LIMIT 3
            ) preview;
SET plan_cache_mode=force_custom_plan;
\echo force_custom_plan imported_older run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,false,51);
\echo force_custom_plan imported_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,false,51);
\echo force_custom_plan imported_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,true,51);
\echo force_custom_plan imported_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,true,51);
\echo force_custom_plan root_metadata run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE metadata(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_custom_plan root_metadata run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE metadata(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_custom_plan root_preview run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_custom_plan root_preview run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
SET plan_cache_mode=force_generic_plan;
\echo force_generic_plan imported_older run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,false,51);
\echo force_generic_plan imported_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,false,51);
\echo force_generic_plan imported_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,true,51);
\echo force_generic_plan imported_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,true,51);
\echo force_generic_plan root_metadata run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE metadata(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_generic_plan root_metadata run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE metadata(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_generic_plan root_preview run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);
\echo force_generic_plan root_preview run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[]);