from pathlib import Path
import re
script=Path('/tmp/channels-query-plans.sql').read_text()
queries={name:sql for name,sql in re.findall(r'PREPARE (\w+)\(.*?\) AS (.*?);',script,re.S) if not name.startswith('thread')}
# Cursors use the same 32,000-root depth as the plan measurement.
start='''\\pset pager off
SET default_transaction_read_only=on; SET statement_timeout='60s';
SELECT parent_entity_id AS channel_id FROM comms_messages WHERE parent_entity_type='channel' GROUP BY parent_entity_id ORDER BY count(*) DESC LIMIT 1 \\gset
SELECT created_at AS cursor_ts,id AS cursor_id FROM comms_messages WHERE parent_entity_type='channel' AND parent_entity_id=:'channel_id' AND thread_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 OFFSET 32000 \\gset
'''
out=[start]
for direction in ['older','newer']:
 for depth in ['latest','deep']:
  for limit in [1,50,100]:
   args={1:"'channel'",2:":'channel_id'",3:'NULL' if depth=='latest' else ":'cursor_ts'::timestamptz",4:'NULL' if depth=='latest' else ":'cursor_id'::uuid",5:str(limit),6:'NULL',7:'NULL',8:'NULL',9:'NULL',10:'false'}
   def bind(sql):return re.sub(r'\$(\d+)',lambda m:args[int(m.group(1))],sql)
   old=bind(queries[direction+'_before']);new=bind(queries[direction+'_after'])
   out.append(f'''WITH old_page AS ({old}), new_page AS ({new}), changed AS ((SELECT * FROM old_page EXCEPT ALL SELECT * FROM new_page) UNION ALL (SELECT * FROM new_page EXCEPT ALL SELECT * FROM old_page)) SELECT '{direction}_{depth}_{limit}' AS selection, count(*) AS different_rows FROM changed;''')
Path('/tmp/channels-sql-parity.sql').write_text('\n'.join(out))
