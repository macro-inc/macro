-- Scratch databases only: this seeds synthetic calls and rolls back every change.
\set ON_ERROR_STOP on
\if :{?stale}
\else
\set stale false
\endif
\timing on
\echo Call-owned metadata lookup. Run each statistics mode on its own new, migrated local scratch database.
SHOW server_version;
BEGIN;
-- Allow the 1.1m-row seed to finish; measured queries use 15s below.
SET LOCAL statement_timeout='300s';
SET LOCAL lock_timeout='5s';
SET LOCAL random_page_cost=1.1;
SET LOCAL work_mem='16MB';
SET LOCAL jit=off;
ALTER TABLE call_entities SET (autovacuum_enabled=false);
SET LOCAL session_replication_role=replica;
INSERT INTO call_entities(id,user_id,created_via,share_permission_id,channel_id,discussion)
VALUES('019bf000-0000-7000-8000-000000000001','macro|plan@example.com','manual','plan',
       '019ba000-0000-7000-8000-000000000001','channel_thread')
ON CONFLICT(id) DO NOTHING;
\if :stale
ANALYZE call_entities;
\endif
INSERT INTO call_entities(id,user_id,created_via,share_permission_id,channel_id,discussion)
SELECT ('019bf000-0000-7000-8000-'||lpad(entry::text,12,'0'))::uuid,
       'macro|plan@example.com','manual','plan',
       ('019ba000-0000-7000-8000-'||lpad((1+(entry-1)/100000)::text,12,'0'))::uuid,
       CASE WHEN entry%2=1 THEN 'channel_thread' ELSE 'call_chat' END
FROM generate_series(1,1100000)entry
ON CONFLICT(id) DO NOTHING;
SET LOCAL session_replication_role=origin;
\if :stale
\echo retaining small-fixture statistics
\else
ANALYZE call_entities;
\endif
SELECT clock_timestamp() AS measured_at,count(*) AS call_entities FROM call_entities;
SET LOCAL statement_timeout='15s';
PREPARE call_thread(uuid) AS
SELECT channel_id AS "channel_id!" FROM call_entities
           WHERE id = $1 AND discussion = 'channel_thread' AND channel_id IS NOT NULL;
\echo thread custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000001');
\echo thread custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000001');
\echo thread generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000001');
\echo thread generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000001');
\echo legacy custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000002');
\echo legacy custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000002');
\echo legacy generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000002');
\echo legacy generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-000000000002');
\echo missing custom first
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-999999999999');
\echo missing custom repeated
SET LOCAL plan_cache_mode=force_custom_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-999999999999');
\echo missing generic first
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-999999999999');
\echo missing generic repeated
SET LOCAL plan_cache_mode=force_generic_plan;
EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)EXECUTE call_thread('019bf000-0000-7000-8000-999999999999');
DEALLOCATE call_thread;
ROLLBACK;
