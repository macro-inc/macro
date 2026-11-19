\pset pager off
SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';
SELECT version();
PREPARE thread_older(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS SELECT to_jsonb(page) AS "message!: Json<StoredMessage>" FROM (
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $4::bigint IS NOT NULL AND m.import_order IS NOT NULL
          AND (m.import_order, m.created_at, m.id) < ($4, $5, $6)
        ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $7::boolean AND m.import_order IS NOT NULL
        ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $8::timestamptz IS NOT NULL AND m.import_order IS NULL
          AND (m.created_at, m.id) < ($8, $9)
        ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $10::boolean AND m.import_order IS NULL
        ORDER BY m.import_order DESC NULLS FIRST, m.created_at DESC, m.id DESC
        LIMIT $11)
) page
ORDER BY page.import_order DESC NULLS FIRST, page.created_at DESC, page.id DESC
LIMIT $11

;
PREPARE thread_newer(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS SELECT to_jsonb(page) AS "message!: Json<StoredMessage>" FROM (
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $4::bigint IS NOT NULL AND m.import_order IS NOT NULL
          AND (m.import_order, m.created_at, m.id) > ($4, $5, $6)
        ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $7::boolean AND m.import_order IS NOT NULL
        ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $8::timestamptz IS NOT NULL AND m.import_order IS NULL
          AND (m.created_at, m.id) > ($8, $9)
        ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
        LIMIT $11)
    UNION ALL
    (SELECT m.* FROM comms_messages m
        WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
          AND m.thread_id = $3 AND m.deleted_at IS NULL
          AND $10::boolean AND m.import_order IS NULL
        ORDER BY m.import_order ASC NULLS LAST, m.created_at ASC, m.id ASC
        LIMIT $11)
) page
ORDER BY page.import_order ASC NULLS LAST, page.created_at ASC, page.id ASC
LIMIT $11

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
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,false,51);
\echo force_custom_plan imported_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,false,51);
\echo force_custom_plan imported_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,true,51);
\echo force_custom_plan imported_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,true,51);
SET plan_cache_mode=force_generic_plan;
\echo force_generic_plan imported_older run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,false,51);
\echo force_generic_plan imported_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,false,51);
\echo force_generic_plan imported_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,true,51);
\echo force_generic_plan imported_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',100175,'2026-01-02 03:49:35+00','019fd3b9-0000-7000-8002-000000099975',false,NULL,NULL,true,51);