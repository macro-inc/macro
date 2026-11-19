#!/usr/bin/env python3
"""Bulk-seed the perf channels via SQL, in the row shape the messages API writes
(verified against API-created rows in #freshness): UUIDv7 ids whose timestamp matches
created_at, thread rows via the insert trigger, soft-deleted rows with empty content,
edited rows with edited_at/updated_at, user mentions (markup + comms_entity_mentions),
reactions, image attachments. Deterministic. Writes bulk.sql + fixture.json.
Usage: python3 -I bulk_seed.py   then   psql $PG -v ON_ERROR_STOP=1 -f bulk.sql
"""
import json, random, datetime as dt
from pathlib import Path
HERE = Path(__file__).resolve().parent
ENV = json.loads((HERE / "env.json").read_text())
rng = random.Random(20261111)
NOW = dt.datetime(2026, 11, 11, 20, 30, 0, tzinfo=dt.timezone.utc)  # fixed "latest" time (just before seeding)
USERS = ["alice","bob","carol","dave","erin","frank","grace","heidi","ivan","judy","kevin","laura","mallory","nina","oscar","priya","quentin","rosa","sam","tina","umar"]
NAMES = {"alice":"Alice Quinn","bob":"Bob Marsh","carol":"Carol Diaz","dave":"Dave Okafor","erin":"Erin Walsh"}
uid = lambda k: f"macro|{k}@seed.macro.local"
WEIGHTS = [1.0 / (i + 1) ** 0.7 for i in range(len(USERS))]
EMOJI = ["👍","❤️","😂","🎉","👀","🙏","🔥","✅"]
IMAGE_ID = "4b55eb10-f263-4af6-b167-9001d7cc81c9"  # uploaded through the API by api_probe.cjs
WORDS = ("the launch plan needs another pass before friday can someone check staging deploy looks fine metrics dashboard "
 "is flat after rollout customer asked about export feature we should sync tomorrow morning thanks for the review merged "
 "it now seeing flaky test in ci again rebased on main and pushed design doc updated with new diagrams latency dropped "
 "after index change will follow up with the team quick question about the migration window rollback worked as expected").split()
def sentence(lo, hi):
    n = rng.randint(lo, hi); w = [rng.choice(WORDS) for _ in range(n)]
    return (" ".join(w)).capitalize() + rng.choice([".", ".", "?", "!"])
def content():
    r = rng.random()
    if r < 0.55: return sentence(3, 14)
    if r < 0.85: return " ".join(sentence(5, 16) for _ in range(rng.randint(2, 3)))
    if r < 0.93: return sentence(4, 10) + "\n\n" + "\n".join(f"- {sentence(3, 9)}" for _ in range(rng.randint(2, 5)))
    if r < 0.97: return sentence(4, 10) + "\n\n```ts\nconst result = await fetchPage({ limit: 50 });\nconsole.log(result.items.length);\n```\n\n" + sentence(4, 9)
    return "\n\n".join(" ".join(sentence(8, 18) for _ in range(3)) for _ in range(rng.randint(2, 3)))
def uuid7(ts):
    ms = int(ts.timestamp() * 1000); r = rng.getrandbits(74)
    v = (ms << 80) | (0x7 << 76) | ((r >> 62) << 64) | (0b10 << 62) | (r & ((1 << 62) - 1))
    h = f"{v:032x}"; return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"
esc = lambda s: s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")
tsz = lambda t: t.strftime("%Y-%m-%d %H:%M:%S.%f+00")
tsn = lambda t: t.strftime("%Y-%m-%d %H:%M:%S.%f")
NULL = "\\N"

# name -> (roots, span, big threads [(position from latest root, replies)], total replies)
SPECS = {
  "small":  dict(roots=38,    span=dt.timedelta(days=3),   big=[(30, 8), (12, 3), (5, 1)], replies=12),
  "medium": dict(roots=1500,  span=dt.timedelta(days=60),  big=[(1100, 130), (20, 60)], replies=500),
  "large":  dict(roots=40000, span=dt.timedelta(days=540), big=[(30000, 250), (15000, 150), (20, 110)], replies=10000),
}
msgs, reacts, ments, atts = [], [], [], []
fixture = {"now": NOW.isoformat(), "channels": {}}
for name, spec in SPECS.items():
    ch = ENV["channels"][name]; R = spec["roots"]
    # root timestamps: sorted random offsets in the span, last one 10 minutes before NOW
    offs = sorted(rng.random() for _ in range(R))
    start = NOW - spec["span"]; end = NOW - dt.timedelta(minutes=10)
    root_ts = [start + (end - start) * (o / offs[-1]) for o in offs]
    replies_for = {}
    for pos, n in spec["big"]: replies_for[R - 1 - pos] = n
    left = spec["replies"] - sum(n for _, n in spec["big"])
    while left > 0:
        i = rng.randrange(0, R - 1)  # never the last root: the timeline's bottom row stays a plain root
        if i in replies_for: continue
        n = min(left, rng.choice([1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 12])); replies_for[i] = n; left -= n
    roots = []; counts = dict(roots=0, replies=0, edited=0, deleted=0, mentions=0, reactions=0, reacted_messages=0, attachments=0, threads=0, threads_gt3=0, threads_100plus=0)
    def emit(ts, thread_id, protect=False):
        mid = uuid7(ts); sender = rng.choices(USERS, WEIGHTS)[0]; text = content(); edited = deleted = None; upd = ts
        r = rng.random()
        if not protect and r < 0.007:
            deleted = ts + dt.timedelta(minutes=rng.randint(1, 30)); upd = deleted; text = ""; counts["deleted"] += 1
        elif r < 0.037:
            edited = ts + dt.timedelta(minutes=rng.randint(1, 30)); upd = edited; counts["edited"] += 1
        if deleted is None and rng.random() < 0.03:
            who = rng.choice([u for u in USERS if u != sender])
            text = f'<m-user-mention>{{"userId":"{uid(who)}","email":"{who}@seed.macro.local","displayName":"{NAMES.get(who, who.capitalize())}"}}</m-user-mention> ' + text
            ments.append((tsz(ts), "user", uid(who), "message", mid, uuid7(ts), uid(sender))); counts["mentions"] += 1
        if deleted is None and rng.random() < 0.10:
            counts["reacted_messages"] += 1
            for e in rng.sample(EMOJI, rng.choice([1, 1, 1, 2, 2, 3])):
                for u in rng.sample(USERS, rng.choice([1, 1, 2, 3, 5])):
                    reacts.append((mid, e, uid(u), tsz(ts + dt.timedelta(minutes=rng.randint(1, 600))))); counts["reactions"] += 1
        if deleted is None and rng.random() < 0.005:
            atts.append((uuid7(ts), mid, "static/image", IMAGE_ID, tsz(ts), 800, 600)); counts["attachments"] += 1
        msgs.append((mid, thread_id or NULL, uid(sender), esc(text), tsz(ts), tsz(upd), tsn(edited) if edited else NULL, tsn(deleted) if deleted else NULL, "channel", ch, "message"))
        return mid, deleted is not None
    thread_info = {}
    for i, ts in enumerate(root_ts):
        n = replies_for.get(i, 0)
        mid, dele = emit(ts, None, protect=(n >= 50 or i >= R - 60 or i == int(R * 0.2)))
        roots.append((mid, dele)); counts["roots"] += 1
        if n:
            counts["threads"] += 1; counts["threads_gt3"] += n > 3; counts["threads_100plus"] += n >= 100
            gap = min(dt.timedelta(minutes=rng.randint(1, 10)), (NOW - dt.timedelta(minutes=1) - ts) / (n + 1))
            rids = []
            for k in range(n):
                rid, rdel = emit(ts + gap * (k + 1), mid, protect=(n >= 50)); rids.append(rid); counts["replies"] += 1
            thread_info[i] = rids
    live = [m for m, d in roots if not d]
    bigs = sorted(((len(v), i) for i, v in thread_info.items()), reverse=True)
    old_i = int(R * 0.2)
    deep_i = R - 1 - spec["big"][0][0]; deep = thread_info[deep_i]
    fixture["channels"][name] = {
        "id": ch, "counts": {**counts, "total": counts["roots"] + counts["replies"]},
        "lastRootId": roots[-1][0], "latestRootIds": live[-60:],
        "latestPageThreads": [{"rootId": roots[i][0], "replies": len(thread_info[i])} for i in sorted(thread_info) if i >= R - 50],
        "oldRoot": {"id": roots[old_i][0], "indexFromLatest": R - 1 - old_i, "createdAt": root_ts[old_i].isoformat()},
        "threadReply": {"rootId": roots[deep_i][0], "rootIndexFromLatest": R - 1 - deep_i, "replyId": deep[int(len(deep) * 0.7)],
                        "replyIndex": int(len(deep) * 0.7), "threadReplies": len(deep)},
        "biggestThreads": [{"rootId": roots[i][0], "replies": n, "rootIndexFromLatest": R - 1 - i} for n, i in bigs[:4]],
    }
with open(HERE / "bulk.sql", "w") as f:
    f.write("BEGIN;\nSET LOCAL synchronous_commit = off;\n")
    ids = ",".join(f"'{ENV['channels'][n]}'" for n in SPECS)
    f.write(f"DELETE FROM comms_messages WHERE channel_message_parent_id IN ({ids});\n")
    def copy(table, cols, rows):
        f.write(f"COPY {table} ({','.join(cols)}) FROM STDIN;\n")
        for r in rows: f.write("\t".join(str(x) for x in r) + "\n")
        f.write("\\.\n")
    copy("comms_messages", ["id","thread_id","sender_id","content","created_at","updated_at","edited_at","deleted_at","parent_entity_type","parent_entity_id","kind"], msgs)
    copy("comms_reactions", ["message_id","emoji","user_id","created_at"], sorted(set(reacts), key=lambda r: r[0]))
    copy("comms_entity_mentions", ["created_at","entity_type","entity_id","source_entity_type","source_entity_id","id","user_id"], ments)
    copy("comms_attachments", ["id","message_id","entity_type","entity_id","created_at","width","height"], atts)
    f.write(f"UPDATE comms_channels SET updated_at = now() WHERE id IN ({ids});\nCOMMIT;\nANALYZE comms_messages; ANALYZE comms_message_threads; ANALYZE comms_reactions; ANALYZE comms_entity_mentions; ANALYZE comms_attachments;\n")
(HERE / "fixture.json").write_text(json.dumps(fixture, indent=1))
print(json.dumps({k: v["counts"] for k, v in fixture["channels"].items()}, indent=1))
