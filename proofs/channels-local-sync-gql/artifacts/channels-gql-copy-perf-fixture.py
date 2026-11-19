import csv
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

PSQL = '/nix/store/48ya21bqynykp51pm07f82svs3kspb42-postgresql-16.14/bin/psql'
PRIVATE_URL = 'postgres://user@localhost/macrodb?host=/tmp&port=35432'
CONFIG = json.loads(Path('<home>/.cache/channels-perf/env.json').read_text())
SOURCE_URL = CONFIG['pg']
CHANNEL = str(uuid.UUID(CONFIG['channels']['large']))
DIRECTORY = Path('/tmp/channels-gql-private-fixture')
DIRECTORY.mkdir(exist_ok=True)

source_env = dict(os.environ, PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000 -c TimeZone=UTC')
private_env = dict(os.environ, PGOPTIONS='-c statement_timeout=120000 -c TimeZone=UTC')

def query(url, sql, env):
    result = subprocess.run([PSQL, url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                            env=env, capture_output=True, check=True)
    return result.stdout.decode().strip()

assert query(SOURCE_URL, "SHOW transaction_read_only", source_env) == 'on'
assert query(PRIVATE_URL, 'SELECT 1 FROM channel_change_counters LIMIT 0', private_env) == ''
assert query(PRIVATE_URL, f"SELECT count(*) FROM comms_channels WHERE id='{CHANNEL}'", private_env) == '0', 'refusing to overwrite an existing private channel'
assert query(SOURCE_URL, f"SELECT team_id IS NULL AND label_id IS NULL FROM comms_channels WHERE id='{CHANNEL}'", source_env) == 't'
assert query(SOURCE_URL, f"SELECT count(*) FROM comms_messages WHERE parent_entity_type='channel' AND parent_entity_id='{CHANNEL}' AND kind <> 'message'", source_env) == '0'

message_scope = f"parent_entity_type='channel' AND parent_entity_id='{CHANNEL}'"
message_ids = f"SELECT id FROM comms_messages WHERE {message_scope}"
tables = [
    ('comms_channels', f"id='{CHANNEL}'", 'id', None),
    ('comms_messages', message_scope, 'thread_id IS NOT NULL, created_at, id', None),
    ('comms_message_threads', f'root_id IN ({message_ids})', 'root_id', 'root_id'),
    ('comms_attachments', f'message_id IN ({message_ids})', 'id', None),
    ('comms_reactions', f'message_id IN ({message_ids})', 'message_id, emoji, user_id', None),
    ('comms_entity_mentions', f"source_entity_type='message' AND source_entity_id IN (SELECT id::text FROM comms_messages WHERE {message_scope})", 'id', None),
    ('activity_events', f"entity_type='channel' AND entity_id='{CHANNEL}'", 'id', None),
]
statements = [
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '120s';",
    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM comms_channels WHERE id='{CHANNEL}') THEN RAISE EXCEPTION 'fixture already exists'; END IF; END $$;",
]
manifest = {}
for table, predicate, order, update_key in tables:
    columns = query(SOURCE_URL, f"SELECT quote_ident(attname) FROM pg_attribute WHERE attrelid='{table}'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='' AND attidentity='' ORDER BY attnum", source_env).splitlines()
    selected = ','.join(columns)
    export = f'COPY (SELECT {selected} FROM {table} WHERE {predicate} ORDER BY {order}) TO STDOUT WITH (FORMAT csv)'
    path = DIRECTORY / f'{table}.csv'
    with path.open('wb') as output:
        subprocess.run([PSQL, SOURCE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', export],
                       env=source_env, stdout=output, check=True)
    with path.open(newline='') as rows:
        count = sum(1 for _ in csv.reader(rows))
    manifest[table] = {'rows': count, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    print(table, count)
    stage = 'perf_' + table
    statements.extend([
        f'CREATE TEMP TABLE {stage} ON COMMIT DROP AS SELECT {selected} FROM {table} WITH NO DATA;',
        f"\\copy {stage} ({selected}) FROM '{path}' WITH (FORMAT csv)",
    ])
    conflict = 'DO NOTHING'
    if update_key:
        updates = ','.join(f'{column}=EXCLUDED.{column}' for column in columns if column != update_key)
        conflict = f'({update_key}) DO UPDATE SET {updates}'
    statements.append(f'INSERT INTO {table} ({selected}) SELECT {selected} FROM {stage} WHERE true ORDER BY {order} ON CONFLICT {conflict};')
statements.extend([
    f"INSERT INTO channel_change_counters(channel_id,seq) VALUES ('{CHANNEL}',1);",
    f"INSERT INTO channel_change_log(channel_id,seq,kind) VALUES ('{CHANNEL}',1,3);",
    'COMMIT;',
    'ANALYZE comms_channels;',
    'ANALYZE comms_messages;',
    'ANALYZE comms_message_threads;',
    'ANALYZE comms_attachments;',
    'ANALYZE comms_reactions;',
    'ANALYZE comms_entity_mentions;',
    'ANALYZE activity_events;',
    'ANALYZE channel_change_counters;',
    'ANALYZE channel_change_log;',
])
sql_path = DIRECTORY / 'load.sql'
sql_path.write_text('\n'.join(statements) + '\n')
subprocess.run([PSQL, PRIVATE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(sql_path)],
               env=private_env, check=True)
for table, predicate, order, _ in tables:
    columns = query(SOURCE_URL, f"SELECT quote_ident(attname) FROM pg_attribute WHERE attrelid='{table}'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='' AND attidentity='' ORDER BY attnum", source_env).splitlines()
    export = f"COPY (SELECT {','.join(columns)} FROM {table} WHERE {predicate} ORDER BY {order}) TO STDOUT WITH (FORMAT csv)"
    result = subprocess.run([PSQL, PRIVATE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', export], env=private_env, capture_output=True, check=True)
    manifest[table]['private_sha256'] = hashlib.sha256(result.stdout).hexdigest()
    assert manifest[table]['sha256'] == manifest[table]['private_sha256'], f'{table} copy differs from source'
manifest['channel_id'] = CHANNEL
manifest['sequence'] = int(query(PRIVATE_URL, f"SELECT seq FROM channel_change_counters WHERE channel_id='{CHANNEL}'", private_env))
(DIRECTORY / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Private copy verified; sequence:', manifest['sequence'])
