-- Scratch databases only; all synthetic rows and settings roll back.
\set ON_ERROR_STOP on
\if :{?stale}
\else
\set stale false
\endif
\timing on
SHOW server_version;
BEGIN;
SET LOCAL statement_timeout='300s';
SET LOCAL lock_timeout='5s';
SET LOCAL random_page_cost=1.1;
SET LOCAL work_mem='16MB';
SET LOCAL jit=off;
ALTER TABLE agent_external_replies SET (autovacuum_enabled=false);
SET LOCAL session_replication_role=replica;
INSERT INTO agent_external_replies(session_id, action_id, target)
VALUES('019bc000-0000-7000-8000-000000000001', '019bd000-0000-7000-8000-000000000001', '{"synthetic":true}'::jsonb);
\if :stale
ANALYZE agent_external_replies;
\endif
-- 100,000 actions for the selected session and ten such background sessions.
INSERT INTO agent_external_replies(session_id, action_id, target)
SELECT ('019bc000-0000-7000-8000-'||lpad((1+(entry-1)/100000)::text,12,'0'))::uuid,
       ('019bd000-0000-7000-8000-'||lpad(entry::text,12,'0'))::uuid,
       jsonb_build_object('synthetic', true, 'body', repeat('x', 256))
FROM generate_series(2,1100000)entry;
SET LOCAL session_replication_role=origin;
\if :stale
\echo retaining one-row statistics
\else
ANALYZE agent_external_replies;
\endif
SELECT clock_timestamp() AS measured_at, count(*) AS agent_external_replies FROM agent_external_replies;
SET LOCAL statement_timeout='15s';
PREPARE agent_get(uuid, uuid) AS
SELECT to_jsonb(reply) AS "value!" FROM agent_external_replies reply WHERE session_id = $1 AND action_id = $2;
\echo present custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000100000');
\echo present custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000100000');
\echo present generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000100000');
\echo present generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000100000');
\echo missing_action custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-999999999999');
\echo missing_action custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-999999999999');
\echo missing_action generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-999999999999');
\echo missing_action generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-999999999999');
\echo missing_session custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-999999999999','019bd000-0000-7000-8000-000000000001');
\echo missing_session custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-999999999999','019bd000-0000-7000-8000-000000000001');
\echo missing_session generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-999999999999','019bd000-0000-7000-8000-000000000001');
\echo missing_session generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE agent_get('019bc000-0000-7000-8000-999999999999','019bd000-0000-7000-8000-000000000001');
DEALLOCATE agent_get;
ROLLBACK;
