from pathlib import Path
import re
src=Path('crates/messages/src/outbound/pg_message_repo/timeline.rs').read_text()
queries={}
for direction in ['older','newer']:
 part=src[src.index('    async fn '+direction+'('):]
 sql=re.search(r'r#"(SELECT to_jsonb\(m\).*?)"#,',part,re.S).group(1)
 queries[direction+'_after']=sql
 old=re.sub(r"AND \(m.created_at, m.id\) ([<>]) \(COALESCE\(\$3::timestamptz, '[^']+'::timestamptz\), COALESCE\(\$4::uuid, '[^']+'::uuid\)\)",r'AND ($3::timestamptz IS NULL OR (m.created_at, m.id) \1 ($3, $4::uuid))',sql)
 queries[direction+'_before']=old.replace(' OFFSET 0','')
out=['\\pset pager off','SET default_transaction_read_only=on; SET random_page_cost=1.1; SET work_mem=\'16MB\'; SET jit=off; SET statement_timeout=\'60s\';','SELECT version();',"SELECT parent_entity_id AS channel_id FROM comms_messages WHERE parent_entity_type='channel' GROUP BY parent_entity_id ORDER BY count(*) DESC LIMIT 1 \\gset", "SELECT created_at AS cursor_ts, id AS cursor_id FROM comms_messages WHERE parent_entity_type='channel' AND parent_entity_id=:'channel_id' AND thread_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET 32000 \\gset", "SELECT thread_id AS root_id FROM comms_messages WHERE thread_id IS NOT NULL GROUP BY thread_id ORDER BY count(*) DESC LIMIT 1 \\gset", "SELECT created_at AS reply_ts,id AS reply_id FROM comms_messages WHERE thread_id=:'root_id' ORDER BY import_order NULLS LAST,created_at,id LIMIT 1 OFFSET 150 \\gset"]
for name,sql in queries.items():
 out.append('PREPARE '+name+'(text,text,timestamptz,uuid,bigint,uuid[],bool,timestamptz,timestamptz,bool) AS '+sql+';')
for direction in ['older','newer']:
 sql=Path('crates/messages/src/outbound/pg_message_repo/thread_'+direction+'.sql').read_text()
 out.append('PREPARE thread_'+direction+'(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS '+sql+';')
for mode in ['force_custom_plan','force_generic_plan']:
 out.append('SET plan_cache_mode='+mode+';')
 for name in queries:
  for run in [1,2]:
   out.extend(['\\echo '+mode+' '+name+' run'+str(run),"EXPLAIN (ANALYZE,BUFFERS) EXECUTE "+name+"('channel',:'channel_id',:'cursor_ts',:'cursor_id',51,NULL,NULL,NULL,NULL,false);"])
 for direction in ['older','newer']:
  for run in [1,2]:
   out.extend(['\\echo '+mode+' thread_'+direction+' run'+str(run),"EXPLAIN (ANALYZE,BUFFERS) EXECUTE thread_"+direction+"('channel',:'channel_id',:'root_id',NULL,NULL,NULL,"+('true' if direction=='older' else 'false')+",:'reply_ts',:'reply_id',false,51);"])
Path('/tmp/channels-query-plans.sql').write_text('\n'.join(out)+'\n')
