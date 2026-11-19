from pathlib import Path
from datetime import datetime, timezone, timedelta
import re
base=Path('crates/messages/src/outbound/pg_message_repo/timeline.rs').read_text()
metadata=re.search(r'let states = sqlx::query!\(r#"(.*?)"#',base,re.S).group(1)
for size,root,prefix,cursor in [(50,'019fd3b9-0050-7000-8000-000000000001','019fd3b9-0050-7000-8001-',25),(1000,'019fd3b9-1000-7000-8000-000000000001','019fd3b9-1000-7000-8001-',775),(100250,'019fd3b9-0000-7000-8000-000000000001','019fd3b9-0000-7000-8002-',100175)]:
 out=['\\pset pager off',"SET default_transaction_read_only=on; SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';",'SELECT version();']
 for direction in ['older','newer']:
  sql=Path(f'crates/messages/src/outbound/pg_message_repo/thread_{direction}.sql').read_text()
  out.append('PREPARE thread_'+direction+'(text,text,uuid,bigint,timestamptz,uuid,bool,timestamptz,uuid,bool,bigint) AS '+sql+';')
 out.append('PREPARE metadata(uuid[]) AS '+metadata+';')
 at=(datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=cursor)).isoformat()
 cid=prefix+str(cursor-200 if size==100250 else cursor).zfill(12)
 for mode in ['force_custom_plan','force_generic_plan']:
  out.append('SET plan_cache_mode='+mode+';')
  for action in ['latest','older','newer','metadata']:
   for run in [1,2]:
    out.append(f'\\echo {mode} size{size}_{action} run{run}')
    if action=='metadata': call=f"metadata(ARRAY['{root}']::uuid[])"
    elif action=='latest': call=f"thread_newer('channel','019fd3b9-0000-7000-8000-000000000002','{root}',NULL,NULL,NULL,true,NULL,NULL,true,51)"
    else: call=f"thread_{action}('channel','019fd3b9-0000-7000-8000-000000000002','{root}',{cursor},'{at}','{cid}',false,NULL,NULL,{'true' if action=='newer' else 'false'},51)"
    out.append('EXPLAIN (ANALYZE,BUFFERS) EXECUTE '+call+';')
 Path(f'/tmp/channels-thread-{size}-plans.sql').write_text('\n'.join(out))
