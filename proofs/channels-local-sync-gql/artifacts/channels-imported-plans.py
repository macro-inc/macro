from pathlib import Path
import re
src=Path('crates/messages/src/outbound/pg_message_repo/timeline.rs').read_text()
metadata=re.search(r'let states = sqlx::query!\(r#"(.*?)"#',src,re.S).group(1)
preview=re.search(r'let previews = sqlx::query_scalar!\(r#"(.*?)"#',src,re.S).group(1)
out=['\\pset pager off',"SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';",'SELECT version();']
for direction in ['older','newer']:
 sql=Path('crates/messages/src/outbound/pg_message_repo/thread_'+direction+'.sql').read_text()
 out.append('PREPARE thread_'+direction+'(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS '+sql+';')
out.append('PREPARE metadata(uuid[]) AS '+metadata+';')
out.append('PREPARE preview(uuid[]) AS '+preview+';')
for mode in ['force_custom_plan','force_generic_plan']:
 out.append('SET plan_cache_mode='+mode+';')
 for label,execsql in [
 ('imported_older',"thread_older('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,false,51)"),
 ('imported_newer',"thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','019fd3b9-0000-7000-8000-000000000001',175,'2026-01-01 00:02:55+00','019fd3b9-0000-7000-8001-000000000175',false,NULL,NULL,true,51)"),
 ('root_metadata',"metadata(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[])"),
 ('root_preview',"preview(ARRAY['019fd3b9-0000-7000-8000-000000000001']::uuid[])")]:
  for run in [1,2]:out.extend(['\\echo '+mode+' '+label+' run'+str(run),'EXPLAIN (ANALYZE,BUFFERS) EXECUTE '+execsql+';'])
Path('/tmp/channels-imported-plans.sql').write_text('\n'.join(out))
