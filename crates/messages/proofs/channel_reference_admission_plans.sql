\set ON_ERROR_STOP on
\if :{?stale}
\else
\set stale false
\endif
\timing on
SHOW server_version;
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL session_replication_role = replica;
SET LOCAL random_page_cost = 1.1;
SET LOCAL work_mem = '16MB';
SET LOCAL jit = off;
ALTER TABLE slack_import_job SET (autovacuum_enabled = false);
ALTER TABLE slack_import_conversation SET (autovacuum_enabled = false);
ALTER TABLE slack_import_message_reference SET (autovacuum_enabled = false);
INSERT INTO slack_import_job (id,team_id,user_id,idempotency_token,request_sha256,confirmed_unknown,include_message_history,status,registration_closed_at)
VALUES ('019cc000-0000-7000-8000-000000000001','019cc000-0000-7000-8000-000000000000','macro|proof@example.com','019cc000-0000-7000-8000-000000000001',repeat('a',64),true,true,'completed',now());
INSERT INTO slack_import_conversation (job_id,slack_channel_id,kind,name,folder,member_ids,archived,status)
VALUES ('019cc000-0000-7000-8000-000000000001','C1','public_channel','proof','proof',ARRAY[]::text[],false,'completed');
INSERT INTO slack_import_message_reference (job_id,slack_channel_id,message_id,channel_id,importer_version,completed_at)
VALUES ('019cc000-0000-7000-8000-000000000001','C1','019cd000-0000-7000-8000-000000000011','019ce000-0000-7000-8000-000000000001',1,now());
\if :stale
ANALYZE slack_import_job;
ANALYZE slack_import_conversation;
ANALYZE slack_import_message_reference;
\endif
INSERT INTO slack_import_job (id,team_id,user_id,idempotency_token,request_sha256,confirmed_unknown,include_message_history,status,registration_closed_at)
SELECT ('019cc000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,'019cc000-0000-7000-8000-000000000000','macro|proof@example.com',('019cc000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),true,true,'completed',now()
FROM generate_series(1,100000) n ON CONFLICT DO NOTHING;
INSERT INTO slack_import_conversation (job_id,slack_channel_id,kind,name,folder,member_ids,archived,status)
SELECT id,'C1','public_channel','proof','proof',ARRAY[]::text[],false,'completed' FROM slack_import_job ON CONFLICT DO NOTHING;
INSERT INTO slack_import_message_reference (job_id,slack_channel_id,message_id,channel_id,importer_version,completed_at)
SELECT ('019cc000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,'C1',('019cd000-0000-7000-8000-'||lpad((n*10+r)::text,12,'0'))::uuid,('019ce000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,1,now()
FROM generate_series(1,100000) n CROSS JOIN generate_series(1,10) r ON CONFLICT DO NOTHING;
UPDATE slack_import_job SET status='processing' WHERE id='019cc000-0000-7000-8000-000000100000';
UPDATE slack_import_message_reference SET completed_at=NULL,template='{"references":[{}]}'::jsonb WHERE job_id='019cc000-0000-7000-8000-000000100000';
\if :stale
\echo stale one-row statistics retained
\else
ANALYZE slack_import_job;
ANALYZE slack_import_conversation;
ANALYZE slack_import_message_reference;
\endif
SELECT count(*) AS references FROM slack_import_message_reference;
SET LOCAL statement_timeout = '15s';
-- Add an ineligible prefix. Discovery must seek one pending identity; the
-- fixed-job query, not a scan over the prefix, rechecks eligibility.
UPDATE slack_import_job SET status='processing' WHERE id BETWEEN '019cc000-0000-7000-8000-000000010001' AND '019cc000-0000-7000-8000-000000010010';
UPDATE slack_import_conversation SET status='queued' WHERE job_id BETWEEN '019cc000-0000-7000-8000-000000010001' AND '019cc000-0000-7000-8000-000000010010';
UPDATE slack_import_message_reference SET completed_at=NULL,template='{"references":[{}]}'::jsonb WHERE job_id BETWEEN '019cc000-0000-7000-8000-000000010001' AND '019cc000-0000-7000-8000-000000010010';
PREPARE reference_peek (uuid) AS SELECT job_id, message_id, channel_id
           FROM slack_import_message_reference
           WHERE completed_at IS NULL
             AND job_id > COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY job_id, message_id LIMIT 1;
PREPARE reference_job (uuid) AS SELECT j.id, j.team_id FROM slack_import_job j
           WHERE j.id = $1 AND j.registration_closed_at IS NOT NULL
             AND j.status IN ('uploading', 'processing', 'cancelling')
             AND NOT EXISTS (SELECT 1 FROM slack_import_conversation c WHERE c.job_id = j.id
                 AND c.status IN ('awaiting_uploads', 'queued', 'importing'))
             AND EXISTS (SELECT 1 FROM slack_import_message_reference r
                 WHERE r.job_id = j.id AND r.completed_at IS NULL)
           FOR UPDATE OF j SKIP LOCKED;
PREPARE reference_work (uuid) AS SELECT slack_channel_id, message_id, channel_id, importer_version, template
           FROM slack_import_message_reference WHERE job_id = $1 AND completed_at IS NULL
           ORDER BY message_id LIMIT 1;
\echo reference_admission peek_begin force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek(NULL);
\echo reference_admission peek_begin force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek(NULL);
\echo reference_admission peek_begin force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek(NULL);
\echo reference_admission peek_begin force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek(NULL);
\echo reference_admission peek_after force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000010010');
\echo reference_admission peek_after force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000010010');
\echo reference_admission peek_after force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000010010');
\echo reference_admission peek_after force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000010010');
\echo reference_admission peek_end force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000100000');
\echo reference_admission peek_end force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000100000');
\echo reference_admission peek_end force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000100000');
\echo reference_admission peek_end force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_peek('019cc000-0000-7000-8000-000000100000');
\echo reference_admission job_ready force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000100000');
\echo reference_admission job_ready force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000100000');
\echo reference_admission job_ready force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000100000');
\echo reference_admission job_ready force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000100000');
\echo reference_admission job_blocked force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000010001');
\echo reference_admission job_blocked force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000010001');
\echo reference_admission job_blocked force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000010001');
\echo reference_admission job_blocked force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000010001');
\echo reference_admission job_missing force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000999999');
\echo reference_admission job_missing force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000999999');
\echo reference_admission job_missing force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000999999');
\echo reference_admission job_missing force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_job('019cc000-0000-7000-8000-000000999999');
\echo reference_admission work_ready force_custom_plan first
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_work('019cc000-0000-7000-8000-000000100000');
\echo reference_admission work_ready force_custom_plan repeated
SET LOCAL plan_cache_mode='force_custom_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_work('019cc000-0000-7000-8000-000000100000');
\echo reference_admission work_ready force_generic_plan first
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_work('019cc000-0000-7000-8000-000000100000');
\echo reference_admission work_ready force_generic_plan repeated
SET LOCAL plan_cache_mode='force_generic_plan';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) EXECUTE reference_work('019cc000-0000-7000-8000-000000100000');
DEALLOCATE reference_peek;
DEALLOCATE reference_job;
DEALLOCATE reference_work;
ROLLBACK;
