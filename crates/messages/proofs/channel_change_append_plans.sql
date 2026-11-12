\set ON_ERROR_STOP on
\if :{?stale}
\else
\set stale false
\endif
\timing on
\echo Channel sequence append plans. Run with -v stale=false and -v stale=true on separate fresh scratch databases. All changes roll back.
SHOW server_version;
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';
SET LOCAL random_page_cost = 1.1;
SET LOCAL work_mem = '16MB';
SET LOCAL jit = off;
ALTER TABLE channel_change_log SET (autovacuum_enabled = false);
ALTER TABLE channel_change_counters SET (autovacuum_enabled = false);
-- Small analyzed fixture precedes the bulk seed only in stale-statistics mode.
INSERT INTO channel_change_counters (channel_id, seq)
VALUES ('019ba000-0000-7000-8000-000000000001', 1)
ON CONFLICT (channel_id) DO NOTHING;
INSERT INTO channel_change_log (channel_id, seq, kind, message_id)
VALUES ('019ba000-0000-7000-8000-000000000001', 1, 1, '019bc000-0000-7000-8000-000000000001')
ON CONFLICT (channel_id, seq) DO NOTHING;
\if :stale
ANALYZE channel_change_log;
ANALYZE channel_change_counters;
\endif
INSERT INTO channel_change_counters (channel_id, seq)
SELECT ('019ba000-0000-7000-8000-' || lpad(channel::text,12,'0'))::uuid, 100000
FROM generate_series(1,11) AS channel
ON CONFLICT (channel_id) DO UPDATE SET seq = GREATEST(channel_change_counters.seq, EXCLUDED.seq);
INSERT INTO channel_change_log (channel_id, seq, kind, message_id)
SELECT ('019ba000-0000-7000-8000-' || lpad(channel::text,12,'0'))::uuid, entry, 1,
       ('019bb000-0000-7000-8000-' || lpad((channel * 1000000 + entry)::text,12,'0'))::uuid
FROM generate_series(1,11) AS channel CROSS JOIN generate_series(1,100000) AS entry
ON CONFLICT (channel_id, seq) DO NOTHING;
\if :stale
\echo stale statistics retained from the one-row fixture
\else
ANALYZE channel_change_log;
ANALYZE channel_change_counters;
\endif
SELECT clock_timestamp() AS measured_at, count(*) AS total_log_rows FROM channel_change_log;
SELECT channel_id, count(*) FROM channel_change_log
WHERE channel_id BETWEEN '019ba000-0000-7000-8000-000000000001' AND '019ba000-0000-7000-8000-000000000011'
GROUP BY channel_id ORDER BY channel_id;
SET LOCAL statement_timeout = '15s';

PREPARE append_timeout AS WITH saved AS MATERIALIZED (
                SELECT current_setting('statement_timeout') AS value
            ), configured AS MATERIALIZED (
                SELECT set_config('statement_timeout', CASE
                    WHEN value::interval > interval '0'
                        AND value::interval < interval '50 milliseconds' THEN value
                    ELSE '50ms' END, true) AS value
                FROM saved
            )
            SELECT saved.value AS "previous!" FROM saved CROSS JOIN configured
            WHERE configured.value IS NOT NULL;

\echo append_timeout force_custom_plan first
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_timeout;
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_timeout force_custom_plan repeated
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_timeout;
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_timeout force_generic_plan first
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_timeout;
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_timeout force_generic_plan repeated
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_timeout;
ROLLBACK TO measured_write;
RELEASE measured_write;

DEALLOCATE append_timeout;

PREPARE append_scalar (uuid, smallint, uuid, uuid, text) AS WITH next AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                VALUES ($1, 1)
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + 1, updated_at = now()
                RETURNING seq
            ), logged AS (
                INSERT INTO channel_change_log (channel_id, seq, kind, message_id, activity_id)
                SELECT $1, next.seq, $2, $3, $4 FROM next
                RETURNING seq
            ), restored AS MATERIALIZED (
                SELECT set_config('statement_timeout', $5, true) AS value
                FROM (SELECT count(*) AS completed FROM logged) done
                WHERE done.completed > 0
            )
            SELECT logged.seq AS "seq!" FROM logged CROSS JOIN restored
            WHERE restored.value IS NOT NULL;

\echo append_scalar force_custom_plan first
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_scalar('019ba000-0000-7000-8000-000000000001', 1::smallint, '019bc000-0000-7000-8000-000000000001', NULL, '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_scalar force_custom_plan repeated
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_scalar('019ba000-0000-7000-8000-000000000001', 1::smallint, '019bc000-0000-7000-8000-000000000001', NULL, '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_scalar force_generic_plan first
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_scalar('019ba000-0000-7000-8000-000000000001', 1::smallint, '019bc000-0000-7000-8000-000000000001', NULL, '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_scalar force_generic_plan repeated
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_scalar('019ba000-0000-7000-8000-000000000001', 1::smallint, '019bc000-0000-7000-8000-000000000001', NULL, '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;
DEALLOCATE append_scalar;

PREPARE append_activity (uuid[], uuid[], text) AS
            WITH pending AS MATERIALIZED (
                SELECT channel_id, activity_id,
                       row_number() OVER (PARTITION BY channel_id ORDER BY ordinal) AS position,
                       count(*) OVER (PARTITION BY channel_id) AS total
                FROM UNNEST($1::uuid[], $2::uuid[]) WITH ORDINALITY
                    AS input(channel_id, activity_id, ordinal)
            ), advanced AS (
                INSERT INTO channel_change_counters (channel_id, seq)
                SELECT channel_id, total FROM pending
                GROUP BY channel_id, total ORDER BY channel_id
                ON CONFLICT (channel_id) DO UPDATE
                SET seq = channel_change_counters.seq + EXCLUDED.seq,
                    updated_at = clock_timestamp()
                RETURNING channel_id, seq
            ), logged AS (
                INSERT INTO channel_change_log (channel_id, seq, kind, activity_id)
                SELECT pending.channel_id, advanced.seq - pending.total + pending.position,
                       2, pending.activity_id
                FROM pending JOIN advanced USING (channel_id)
                ORDER BY pending.channel_id, pending.position
                RETURNING activity_id, seq
            ), restored AS MATERIALIZED (
                SELECT set_config('statement_timeout', $3, true) AS value
                FROM (SELECT count(*) AS completed FROM logged) done
                WHERE done.completed > 0
            )
            SELECT logged.activity_id AS "activity_id!", logged.seq AS "seq!"
            FROM logged CROSS JOIN restored WHERE restored.value IS NOT NULL
            ;

\echo append_activity force_custom_plan first
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_activity(ARRAY['019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001','019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001']::uuid[], ARRAY['019bd000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000000002','019bd000-0000-7000-8000-000000000003','019bd000-0000-7000-8000-000000000004']::uuid[], '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_activity force_custom_plan repeated
SET LOCAL plan_cache_mode = 'force_custom_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_activity(ARRAY['019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001','019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001']::uuid[], ARRAY['019bd000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000000002','019bd000-0000-7000-8000-000000000003','019bd000-0000-7000-8000-000000000004']::uuid[], '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_activity force_generic_plan first
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_activity(ARRAY['019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001','019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001']::uuid[], ARRAY['019bd000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000000002','019bd000-0000-7000-8000-000000000003','019bd000-0000-7000-8000-000000000004']::uuid[], '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;

\echo append_activity force_generic_plan repeated
SET LOCAL plan_cache_mode = 'force_generic_plan';
SAVEPOINT measured_write;
SET LOCAL statement_timeout = '50ms';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE append_activity(ARRAY['019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001','019ba000-0000-7000-8000-000000000002','019ba000-0000-7000-8000-000000000001']::uuid[], ARRAY['019bd000-0000-7000-8000-000000000001','019bd000-0000-7000-8000-000000000002','019bd000-0000-7000-8000-000000000003','019bd000-0000-7000-8000-000000000004']::uuid[], '15s');
ROLLBACK TO measured_write;
RELEASE measured_write;
DEALLOCATE append_activity;

ROLLBACK;
