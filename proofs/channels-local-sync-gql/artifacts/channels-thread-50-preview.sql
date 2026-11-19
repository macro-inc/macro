\pset pager off
SET default_transaction_read_only=on; SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';
PREPARE preview(uuid[]) AS SELECT to_jsonb(preview) AS "message!: Json<StoredMessage>"
            FROM unnest($1::uuid[]) root(id) CROSS JOIN LATERAL (
                SELECT r.* FROM comms_messages r WHERE r.thread_id = root.id AND r.deleted_at IS NULL
                ORDER BY r.import_order NULLS LAST, r.created_at, r.id LIMIT 3
            ) preview;
SET plan_cache_mode=force_custom_plan;
\echo force_custom_plan size50_preview run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0050-7000-8000-000000000001']::uuid[]);
\echo force_custom_plan size50_preview run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0050-7000-8000-000000000001']::uuid[]);
SET plan_cache_mode=force_generic_plan;
\echo force_generic_plan size50_preview run1
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0050-7000-8000-000000000001']::uuid[]);
\echo force_generic_plan size50_preview run2
EXPLAIN (ANALYZE,BUFFERS) EXECUTE preview(ARRAY['019fd3b9-0050-7000-8000-000000000001']::uuid[]);