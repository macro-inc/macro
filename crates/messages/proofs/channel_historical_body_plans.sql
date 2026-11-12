-- Supplemental proof of the unchanged historical body guard from baseline
-- 354da677b5. Run only against an existing disposable fixture produced by
-- channel_change_plans.py, never an application database. This script creates
-- no schema or seed; metadata changes and every measured UPDATE roll back.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
SHOW server_version;
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL random_page_cost=1.1;
SET LOCAL work_mem='16MB';
SET LOCAL jit=off;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM comms_messages
        WHERE id = '00000000-0000-0000-0000-000000989681'
          AND parent_entity_type = 'channel'
          AND parent_entity_id = '00000000-0000-0000-0000-000000000014'
          AND content = 'message 1'
          AND edited_at IS NULL AND deleted_at IS NULL
          AND updated_at = created_at
    ) THEN
        RAISE EXCEPTION 'Requires the untouched disposable channel_change_plans.py fixture';
    END IF;
END $$;
UPDATE comms_messages SET import_metadata='{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}'::jsonb WHERE id='00000000-0000-0000-0000-000000989681';
PREPARE historical_body(uuid,text,text,jsonb,text) AS UPDATE comms_messages SET content = $5
               WHERE id = $1
                 AND parent_entity_type = 'channel' AND parent_entity_id = $2::text
                 AND content = $3 AND content <> $5 AND import_metadata @> $4
                 AND deleted_at IS NULL AND edited_at IS NULL AND updated_at = created_at
                 AND NOT EXISTS (SELECT 1 FROM comms_message_threads t
                     WHERE t.root_id = coalesce(comms_messages.thread_id, comms_messages.id)
                       AND t.deleted_at IS NOT NULL);
\echo change custom 1
SET LOCAL plan_cache_mode=force_custom_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','replacement body');
ROLLBACK TO sample;
RELEASE sample;
\echo change custom 2
SET LOCAL plan_cache_mode=force_custom_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','replacement body');
ROLLBACK TO sample;
RELEASE sample;
\echo change generic 1
SET LOCAL plan_cache_mode=force_generic_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','replacement body');
ROLLBACK TO sample;
RELEASE sample;
\echo change generic 2
SET LOCAL plan_cache_mode=force_generic_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','replacement body');
ROLLBACK TO sample;
RELEASE sample;
\echo noop custom 1
SET LOCAL plan_cache_mode=force_custom_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','message 1');
ROLLBACK TO sample;
RELEASE sample;
\echo noop custom 2
SET LOCAL plan_cache_mode=force_custom_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','message 1');
ROLLBACK TO sample;
RELEASE sample;
\echo noop generic 1
SET LOCAL plan_cache_mode=force_generic_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','message 1');
ROLLBACK TO sample;
RELEASE sample;
\echo noop generic 2
SET LOCAL plan_cache_mode=force_generic_plan;
SAVEPOINT sample;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE historical_body('00000000-0000-0000-0000-000000989681','00000000-0000-0000-0000-000000000014','message 1','{"slack_import_job":"00000000-0000-0000-0000-00000000007b","body_version":1}','message 1');
ROLLBACK TO sample;
RELEASE sample;
DEALLOCATE historical_body;
ROLLBACK;
