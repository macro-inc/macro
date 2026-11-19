#!/usr/bin/env python3
"""Write explain.sql: EXPLAIN (ANALYZE, BUFFERS) of the exact open-path queries
(crates/messages/src/outbound/pg_message_repo{,/timeline}.rs) against the large channel,
with generic plans (as sqlx prepared statements get after a few executions)."""
import json
from pathlib import Path
H = Path(__file__).resolve().parent
fx = json.loads((H / "fixture.json").read_text()); c = fx["channels"]["large"]
ch = c["id"]; old = c["oldRoot"]["id"]; big = c["biggestThreads"][0]["rootId"]
OLDER = """SELECT to_jsonb(m) FROM comms_messages m
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
  AND ($3::timestamptz IS NULL OR (m.created_at, m.id) {op} ($3, $4::uuid))
 ORDER BY m.created_at {dir}, m.id {dir} LIMIT $5"""
T = "(text, text, timestamptz, uuid, bigint, uuid[], bool, timestamptz, timestamptz, bool)"
sql = f"""\\pset pager off
SET plan_cache_mode = force_generic_plan;
\\echo ===== ids of the latest page (used by the hydrate queries)
CREATE TEMP TABLE page AS SELECT m.id FROM comms_messages m WHERE m.parent_entity_type='channel' AND m.parent_entity_id='{ch}' AND m.thread_id IS NULL AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 50;
SELECT array_agg(id) AS roots, array_agg(id::text) AS roots_text FROM page \\gset
SELECT created_at AS old_ts FROM comms_messages WHERE id='{old}' \\gset
\\echo ===== Q0 access check is in entity_access (span get_channel_role); not reproduced here
\\echo ===== Q1 older(): latest page, no cursor, LIMIT 51
PREPARE older{T} AS {OLDER.format(op='<', dir='DESC')};
EXPLAIN (ANALYZE, BUFFERS) EXECUTE older('channel','{ch}',NULL,NULL,51,NULL,NULL,NULL,NULL,false);
\\echo ===== Q1b older(): cursor at the old root (deep in history), LIMIT 101
EXPLAIN (ANALYZE, BUFFERS) EXECUTE older('channel','{ch}',:'old_ts','{old}',101,NULL,NULL,NULL,NULL,false);
\\echo ===== Q1c newer(): from the old root, LIMIT 51 (the other half of an around read)
PREPARE newer{T} AS {OLDER.format(op='>', dir='ASC')};
EXPLAIN (ANALYZE, BUFFERS) EXECUTE newer('channel','{ch}',:'old_ts','{old}',51,NULL,NULL,NULL,NULL,false);
\\echo ===== Q2 around anchor resolve
PREPARE anchor(text,text,uuid,bool) AS SELECT to_jsonb(root) FROM comms_messages target
 JOIN comms_messages root ON root.id = COALESCE(target.thread_id, target.id)
 JOIN comms_message_threads state ON state.root_id = root.id
 WHERE target.id = $3 AND target.parent_entity_type = $1 AND target.parent_entity_id = $2
  AND root.parent_entity_type = $1 AND root.parent_entity_id = $2 AND (state.deleted_at IS NULL OR $4)
  AND (root.deleted_at IS NULL OR $1 = 'document' OR ($4 AND state.deleted_at IS NOT NULL) OR EXISTS (
      SELECT 1 FROM comms_messages reply WHERE reply.thread_id = root.id AND reply.deleted_at IS NULL));
EXPLAIN (ANALYZE, BUFFERS) EXECUTE anchor('channel','{ch}','{old}',false);
\\echo ===== Q3 thread states with correlated reply count/max per root (50 roots)
PREPARE states(uuid[]) AS SELECT t.root_id, to_jsonb(t),
 (SELECT count(*) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL),
 (SELECT max(created_at) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL)
 FROM comms_message_threads t WHERE root_id = ANY($1);
EXPLAIN (ANALYZE, BUFFERS) EXECUTE states(:'roots');
\\echo ===== Q4 reply previews (LATERAL LIMIT 3 per root)
PREPARE previews(uuid[]) AS SELECT to_jsonb(preview) FROM unnest($1::uuid[]) root(id) CROSS JOIN LATERAL (
 SELECT r.* FROM comms_messages r WHERE r.thread_id = root.id AND r.deleted_at IS NULL
 ORDER BY r.import_order NULLS LAST, r.created_at, r.id LIMIT 3) preview;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE previews(:'roots');
\\echo ===== Q5 hydrate: attachments
PREPARE att(uuid[]) AS SELECT message_id, id, entity_type, entity_id, width, height, created_at FROM comms_attachments WHERE message_id = ANY($1) ORDER BY created_at, id;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE att(:'roots');
\\echo ===== Q6 hydrate: reactions
PREPARE rea(uuid[]) AS SELECT message_id, emoji, array_agg(user_id ORDER BY user_id) FROM comms_reactions WHERE message_id = ANY($1) GROUP BY message_id, emoji ORDER BY emoji;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE rea(:'roots');
\\echo ===== Q7 hydrate: mentions (text ids)
PREPARE men(text[]) AS SELECT source_entity_id, entity_type, entity_id FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = ANY($1) ORDER BY entity_type, entity_id;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE men(:'roots_text');
\\echo ===== Q8 thread replies (250-reply thread), unpaginated
PREPARE rep(text,text,uuid) AS SELECT to_jsonb(m) FROM comms_messages m WHERE parent_entity_type = $1 AND parent_entity_id = $2 AND thread_id = $3 AND deleted_at IS NULL ORDER BY import_order NULLS LAST, created_at, id;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE rep('channel','{ch}','{big}');
\\echo ===== table sizes
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables WHERE relname LIKE 'comms_%' ORDER BY 2 DESC;
"""
(H / "explain.sql").write_text(sql)
