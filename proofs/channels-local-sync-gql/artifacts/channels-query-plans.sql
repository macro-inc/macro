\pset pager off
SET default_transaction_read_only=on; SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';
SELECT version();
SELECT parent_entity_id AS channel_id FROM comms_messages WHERE parent_entity_type='channel' GROUP BY parent_entity_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT created_at AS cursor_ts, id AS cursor_id FROM comms_messages WHERE parent_entity_type='channel' AND parent_entity_id=:'channel_id' AND thread_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET 32000 \gset
SELECT thread_id AS root_id FROM comms_messages WHERE thread_id IS NOT NULL GROUP BY thread_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT created_at AS reply_ts,id AS reply_id FROM comms_messages WHERE thread_id=:'root_id' ORDER BY import_order NULLS LAST,created_at,id LIMIT 1 OFFSET 150 \gset
PREPARE older_after(text,text,timestamptz,uuid,bigint,uuid[],bool,timestamptz,timestamptz,bool) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND (m.created_at, m.id) < (COALESCE($3::timestamptz, 'infinity'::timestamptz), COALESCE($4::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT $5;
PREPARE older_before(text,text,timestamptz,uuid,bigint,uuid[],bool,timestamptz,timestamptz,bool) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3, $4::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT $5;
PREPARE newer_after(text,text,timestamptz,uuid,bigint,uuid[],bool,timestamptz,timestamptz,bool) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL OFFSET 0))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND (m.created_at, m.id) > (COALESCE($3::timestamptz, '-infinity'::timestamptz), COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT $5;
PREPARE newer_before(text,text,timestamptz,uuid,bigint,uuid[],bool,timestamptz,timestamptz,bool) AS SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND ($3::timestamptz IS NULL OR (m.created_at, m.id) > ($3, $4::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT $5;
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
SET plan_cache_mode=force_custom_plan;
\echo force_custom_plan older_after run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan older_after run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan older_before run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan older_before run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan newer_after run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan newer_after run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan newer_before run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan newer_before run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_custom_plan thread_older run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel',:'channel_id',:'root_id',NULL,NULL,NULL,true,:'reply_ts',:'reply_id',false,51);
\echo force_custom_plan thread_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel',:'channel_id',:'root_id',NULL,NULL,NULL,true,:'reply_ts',:'reply_id',false,51);
\echo force_custom_plan thread_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel',:'channel_id',:'root_id',NULL,NULL,NULL,false,:'reply_ts',:'reply_id',false,51);
\echo force_custom_plan thread_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel',:'channel_id',:'root_id',NULL,NULL,NULL,false,:'reply_ts',:'reply_id',false,51);
SET plan_cache_mode=force_generic_plan;
\echo force_generic_plan older_after run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan older_after run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan older_before run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan older_before run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE older_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan newer_after run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan newer_after run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_after('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan newer_before run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan newer_before run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE newer_before('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);
\echo force_generic_plan thread_older run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel',:'channel_id',:'root_id',NULL,NULL,NULL,true,:'reply_ts',:'reply_id',false,51);
\echo force_generic_plan thread_older run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_older('channel',:'channel_id',:'root_id',NULL,NULL,NULL,true,:'reply_ts',:'reply_id',false,51);
\echo force_generic_plan thread_newer run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel',:'channel_id',:'root_id',NULL,NULL,NULL,false,:'reply_ts',:'reply_id',false,51);
\echo force_generic_plan thread_newer run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_newer('channel',:'channel_id',:'root_id',NULL,NULL,NULL,false,:'reply_ts',:'reply_id',false,51);
