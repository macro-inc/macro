#!/usr/bin/env python3
"""Measure exact channel SQL on fresh and stale disposable local databases.

No existing database is modified or removed. Results include the exact SQL,
seed and first/repeated JSON plans for custom and generic prepared statements.
"""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import json
import re
import shutil
import subprocess
import uuid
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--host", choices=["127.0.0.1", "localhost", "::1"], default="127.0.0.1")
parser.add_argument("--port", type=int, required=True, help="Port of a dedicated local test Postgres")
parser.add_argument("--user", required=True, help="Your local test database role")
parser.add_argument("--maintenance-db", default="postgres")
parser.add_argument("--suffix", default=datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f"))
parser.add_argument("--output", type=Path, help="Directory for plans; defaults under /tmp")
args = parser.parse_args()
if not 1 <= args.port <= 65535 or not re.fullmatch(r"[a-z0-9_]{1,30}", args.suffix):
    parser.error("port must be valid and suffix must be 1-30 lowercase letters, digits or underscores")
PSQL = shutil.which("psql")
if PSQL is None:
    parser.error("psql must be on PATH (run inside the repository's Nix environment)")
OUT = args.output or Path("/tmp") / ("channel-change-plans-" + args.suffix)
OUT.mkdir(parents=True, exist_ok=False)
host = "[::1]" if args.host == "::1" else args.host
URL = f"postgresql://{quote(args.user, safe='')}@{host}:{args.port}/"

def run(db, sql):
    result = subprocess.run(
        [PSQL, URL + quote(db, safe=""), "-X", "-v", "ON_ERROR_STOP=1", "-At"],
        input=sql, text=True, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout

def raws(rel): return re.findall(r'r#"(.*?)"#', (ROOT/rel).read_text(), re.S)
def pick(qs,mark): return next(q for q in qs if mark in q)
changes=raws('crates/messages/src/outbound/pg_message_repo/changes.rs')
change_reads=raws('crates/channel_change_db_utils/src/read.rs')
change_pruning=raws('crates/channel_change_db_utils/src/prune.rs')
timeline=raws('crates/messages/src/outbound/pg_message_repo/timeline.rs')
repo=(ROOT/'crates/messages/src/outbound/pg_message_repo.rs').read_text()
repoqs=raws('crates/messages/src/outbound/pg_message_repo.rs')
ids=raws('crates/activity/src/outbound/pg_activity_repo/ids.rs')
write_hydration=pick(raws('crates/messages/src/outbound/pg_message_repo/write_hydration.rs'),'SELECT to_jsonb(m)')
root_ids=[str(uuid.UUID(int=10000000+n)) for n in range(1,20001,100)]
hydrate_ids=[str(uuid.UUID(int=10000000+n+i)) for n in range(1,20001,100) for i in range(4)]
act_ids=[str(uuid.UUID(int=30000000+n)) for n in range(1,201)]
u=lambda v:"'"+str(uuid.UUID(int=v))+"'"
a=lambda xs,typ='uuid': "'{"+','.join(xs)+"}'::"+typ+'[]'
queries={
 'write_hydration':('uuid,text',write_hydration,f'{u(10000001)},{u(20)}'),
 'write_hydration_missing':('uuid,text',write_hydration,f'{u(99999999)},{u(20)}'),
 'reply_root_lock':('uuid,text,text',pick(raws('crates/messages/src/outbound/pg_message_repo/threads.rs'),'FOR KEY SHARE'),f"{u(10000001)},'channel',{u(20)}"),
 'counter':('uuid',pick(change_reads,'SELECT COALESCE'),u(20)),
 'log_caught_up':('uuid,bigint,bigint,bigint',pick(change_reads,'WITH position'),f'{u(20)},100000,1000,1001'),
 'log_delta':('uuid,bigint,bigint,bigint',pick(change_reads,'WITH position'),f'{u(20)},99500,1000,1001'),
 'log_lagged':('uuid,bigint,bigint,bigint',pick(change_reads,'WITH position'),f'{u(20)},0,1000,1001'),
 'log_missing':('uuid,bigint,bigint,bigint',pick(change_reads,'WITH position'),f'{u(999)},0,1000,1001'),
 'changed_messages':('uuid[],text',pick(changes,'SELECT to_jsonb(message)'),f'{a(root_ids)},{u(20)}'),
 'root_rows':('uuid[]',pick(changes,'SELECT to_jsonb(m)'),a(root_ids)),
 'root_states':('uuid[]',pick(timeline,'SELECT t.root_id'),a(root_ids)),
 'root_previews':('uuid[]',pick(timeline,'SELECT to_jsonb(preview)'),a(root_ids)),
 'attachments':('uuid[]',pick(repoqs,'SELECT message_id, id, entity_type'),a(hydrate_ids)),
 'reactions':('uuid[]',pick(repoqs,'SELECT message_id, emoji, array_agg'),a(hydrate_ids)),
 'mentions':('text[]',re.search(r'sqlx::query!\("(SELECT source_entity_id[^"\n]+)"',repo).group(1),a(hydrate_ids,'text')),
 'bots':('uuid[]',re.search(r'"(SELECT id, name, avatar_url FROM bots WHERE id = ANY\(\$1\))"',repo).group(1),a([str(uuid.UUID(int=50000000+n)) for n in range(1,801)])),
 'activities':('uuid[],text,text,text[],text[]',ids[0],f"{a(act_ids)},'channel',{u(20)},'{{renamed}}'::text[],'{{}}'::text[]"),
 'prune':('timestamptz,bigint',pick(change_pruning,'WHERE ctid'),"'2026-10-13 00:00:00+00',10000"),
}
seed = r'''
SET session_replication_role = replica;
INSERT INTO comms_channels(id,channel_type,owner_id)
SELECT lpad(to_hex(n),32,'0')::uuid,'private','macro|plan@example.com' FROM generate_series(20,29)n ON CONFLICT DO NOTHING;
INSERT INTO channel_change_counters(channel_id,seq)
SELECT lpad(to_hex(n),32,'0')::uuid,100000 FROM generate_series(20,29)n ON CONFLICT DO NOTHING;
INSERT INTO channel_change_log(channel_id,seq,kind,message_id,created_at)
SELECT lpad(to_hex(20+(n-1)/100000),32,'0')::uuid,1+(n-1)%100000,1,
       lpad(to_hex(10000000+n),32,'0')::uuid,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,thread_id,sender_id,content,created_at,updated_at)
SELECT lpad(to_hex(10000000+n),32,'0')::uuid,
       'channel',lpad(to_hex(20+(n-1)/100000),32,'0')::uuid::text,
       CASE WHEN (n-1)%100=0 THEN NULL ELSE lpad(to_hex(10000001+(n-1)/100*100),32,'0')::uuid END,
       'macro|plan@example.com','message '||n,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond',
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
SELECT id,parent_entity_type,parent_entity_id,sender_id,created_at,updated_at FROM comms_messages WHERE thread_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO comms_attachments(id,message_id,entity_type,entity_id,created_at)
SELECT lpad(to_hex(20000000+n),32,'0')::uuid,lpad(to_hex(10000000+n),32,'0')::uuid,
       'document','plan-'||n,'2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_reactions(message_id,emoji,user_id)
SELECT lpad(to_hex(10000000+n),32,'0')::uuid,'x','macro|plan@example.com' FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_entity_mentions(id,entity_type,entity_id,source_entity_type,source_entity_id)
SELECT lpad(to_hex(40000000+n),32,'0')::uuid,'user','macro|plan@example.com','message',lpad(to_hex(10000000+n),32,'0')::uuid::text
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
INSERT INTO activity_events(id,actor_id,subject_id,action,action_payload,entity_type,entity_id,occurred_at)
SELECT lpad(to_hex(30000000+n),32,'0')::uuid,'macro|plan@example.com','macro|plan@example.com','renamed',
       '{"from":"before","to":"after"}'::jsonb,'channel',lpad(to_hex(20+(n-1)/100000),32,'0')::uuid::text,
       '2026-09-01 00:00:00+00'::timestamptz+n*interval '1 microsecond'
FROM generate_series(1,1000000)n ON CONFLICT DO NOTHING;
SET session_replication_role=origin;
'''
supplemental_seed = r'''SET session_replication_role=replica;

INSERT INTO channel_change_counters(channel_id,seq)
SELECT lpad(to_hex(n),32,'0')::uuid,0 FROM generate_series(1000,100999)n ON CONFLICT DO NOTHING;
INSERT INTO comms_channels(id,channel_type,owner_id)
VALUES ('00000000-0000-0000-0000-00000000001e','private','macro|plan@example.com') ON CONFLICT DO NOTHING;
INSERT INTO comms_messages(id,parent_entity_type,parent_entity_id,sender_id,content,created_at,updated_at)
SELECT lpad(to_hex(11000000+n),32,'0')::uuid,'channel','00000000-0000-0000-0000-00000000001e',
'macro|plan@example.com','background root',now(),now() FROM generate_series(1,990000)n ON CONFLICT DO NOTHING;
INSERT INTO comms_message_threads(root_id,parent_entity_type,parent_entity_id,user_id,created_at,updated_at)
SELECT id,parent_entity_type,parent_entity_id,sender_id,created_at,updated_at FROM comms_messages
WHERE thread_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO bots(id,kind,owner_user_id,name,handle)
SELECT lpad(to_hex(50000000+n),32,'0')::uuid,'owned','macro|plan@example.com','Plan Bot','plan-bot-'||n
FROM generate_series(1,100000)n ON CONFLICT DO NOTHING;
SET session_replication_role=origin;
'''

# All rows and identifiers are synthetic. Disable triggers only in these new
# disposable databases; the proof exercises the read/index paths, not imports.
small_seed = (seed
    .replace("generate_series(20,29)", "generate_series(20,20)")
    .replace("generate_series(1,1000000)", "generate_series(1,10)")
    .replace("100000 FROM generate_series", "10 FROM generate_series"))
seed += supplemental_seed
(OUT / "seed.sql").write_text(seed)
tables = ["channel_change_counters", "channel_change_log", "comms_channels",
          "comms_messages", "comms_message_threads", "comms_attachments",
          "comms_reactions", "comms_entity_mentions", "activity_events", "bots"]
settings = "SET random_page_cost=1.1; SET work_mem='16MB'; SET jit=off; SET statement_timeout='60s';\n"
summary = []
for name, (types, query, params) in queries.items():
    (OUT / (name + ".sql")).write_text(f"PREPARE {name}({types}) AS\n{query};\nEXECUTE {name}({params});\n")
for stats in ["fresh", "stale"]:
    db = "channel_change_proof_" + args.suffix + ("_stale" if stats == "stale" else "")
    if run(args.maintenance_db, f"SELECT 1 FROM pg_database WHERE datname='{db}';").strip():
        raise RuntimeError("Refusing to reuse existing database: " + db)
    run(args.maintenance_db, f"CREATE DATABASE {db} TEMPLATE template1;")
    print("Created", db, flush=True)
    if stats == "stale":
        run(db, small_seed)
        run(db, "ANALYZE;" + "".join(f"ALTER TABLE {table} SET (autovacuum_enabled=false);" for table in tables))
        run(db, seed)
        run(db, "UPDATE channel_change_counters SET seq=100000 WHERE channel_id BETWEEN '00000000-0000-0000-0000-000000000014' AND '00000000-0000-0000-0000-00000000001d';")
    else:
        run(db, seed)
        run(db, "ANALYZE;")
    counts = [f"SELECT '{table}', count(*) FROM {table};" for table in tables]
    (OUT / (stats + "_sizes.txt")).write_text(run(db, "SHOW server_version;" + "".join(counts)))
    for name, (types, query, params) in queries.items():
        for mode in ["custom", "generic"]:
            sql = settings + f"SET plan_cache_mode=force_{mode}_plan;\nPREPARE q({types}) AS\n{query};\n"
            for repetition in [1, 2]:
                sql += f"BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE q({params});\nROLLBACK;\n"
            output = run(db, sql)
            (OUT / f"{stats}_{name}_{mode}.json.txt").write_text(output)
            decoder = json.JSONDecoder()
            position = 0
            plans = []
            while (start := output.find("[", position)) >= 0:
                try:
                    value, end = decoder.raw_decode(output[start:])
                except json.JSONDecodeError:
                    position = start + 1
                    continue
                if isinstance(value, list) and value and isinstance(value[0], dict) and "Plan" in value[0]:
                    plans.append(value[0])
                position = start + end
            for repetition, plan in enumerate(plans, 1):
                summary.append({"stats": stats, "query": name, "mode": mode,
                    "run": repetition, "ms": plan["Execution Time"],
                    "hits": plan["Plan"].get("Shared Hit Blocks", 0),
                    "reads": plan["Plan"].get("Shared Read Blocks", 0), "plan": plan["Plan"]})
            (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
            print(stats, name, mode, [(p["Execution Time"], p["Plan"].get("Shared Hit Blocks", 0), p["Plan"].get("Shared Read Blocks", 0)) for p in plans], flush=True)
print("Complete:", OUT, "(disposable databases left for inspection)")
