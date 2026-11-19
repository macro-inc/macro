#!/usr/bin/env python3
"""Pull server spans for the channel open path from the shared local Tempo (:3200) and
aggregate span durations per route and channel size. Usage: python3 -I tempo.py [minutes_back=180]
Writes results/tempo.json (+ one full example span tree per route in results/tempo-examples.txt)."""
import json, sys, time, urllib.request, urllib.parse
from pathlib import Path
H = Path(__file__).resolve().parent
fx = json.loads((H / "fixture.json").read_text()); env = json.loads((H / "env.json").read_text())
T = "http://localhost:3200"; back = int(sys.argv[1]) if len(sys.argv) > 1 else 180
end = int(time.time()); start = end - back * 60
def get(path, **p):
    with urllib.request.urlopen(T + path + ("?" + urllib.parse.urlencode(p) if p else ""), timeout=60) as r: return json.load(r)
def q(xs, p):
    xs = sorted(xs)
    if not xs: return None
    pos = (len(xs) - 1) * p; lo = int(pos); hi = min(lo + 1, len(xs) - 1); return round(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo), 2)
ROUTES = {"timeline": "/messages/{parent_type}/{parent_id}/timeline", "thread": "/messages/{parent_type}/{parent_id}/threads/{root_id}",
          "item": "/messages/{parent_type}/{parent_id}/items/{message_id}", "participants": None}
out = {}; examples = []
for size in ["small", "medium", "large"]:
    ch = fx["channels"][size]["id"]
    for label, path in {"timeline": f"/messages/channel/{ch}/timeline", "participants": f"/channels/{ch}/participants", "bots": f"/channels/{ch}/bots", "call_active": f"/call/{ch}/active"}.items():
        tq = f'{{ name="http.request" && span.url.path="{path}" }}'
        res = get("/api/search", q=tq, limit=200, start=start, end=end, spss=1)
        ids = [t["traceID"] for t in res.get("traces", [])]
        agg = {}; kinds = {}
        for n, tid in enumerate(ids):
            try: tr = get(f"/api/traces/{tid}")
            except Exception as e: continue
            spans = []
            for b in tr.get("batches", []):
                for ss in b.get("scopeSpans", []):
                    for s in ss.get("spans", []):
                        at = {a["key"]: list(a["value"].values())[0] for a in s.get("attributes", [])}
                        spans.append((s["name"], int(s["startTimeUnixNano"]), (int(s["endTimeUnixNano"]) - int(s["startTimeUnixNano"])) / 1e6, at))
            spans.sort(key=lambda x: x[1])
            kind = "latest"
            for name, st, dur, at in spans:
                if name == "timeline_entries":
                    qd = str(at.get("query", "")); kind = "around" if "around: Some" in qd else ("cursor" if "cursor: Some" in qd else "latest")
            for name, st, dur, at in spans: agg.setdefault((kind, name), []).append(dur)
            kinds[kind] = kinds.get(kind, 0) + 1
            if n == 0:
                t0 = spans[0][1]; examples.append(f"== {size} {label} trace {tid}")
                for name, st, dur, at in spans: examples.append(f"  +{(st - t0) / 1e6:7.2f} ms  {dur:7.2f} ms  {name}  {str(at.get('query', ''))[:160]}")
        out[f"{size}/{label}"] = {"traces": len(ids), "kinds": kinds, "spans": {f"{k[0]}:{k[1]}": {"n": len(v), "median_ms": q(v, .5), "p90_ms": q(v, .9), "max_ms": round(max(v), 2)} for k, v in sorted(agg.items())}}
(H / "results" / "tempo.json").write_text(json.dumps({"window": [start, end], "routes": out}, indent=1))
(H / "results" / "tempo-examples.txt").write_text("\n".join(examples) + "\n")
for k, v in out.items():
    print(k, v["traces"], v["kinds"])
    for sk, sv in v["spans"].items(): print("   ", sk.ljust(48), sv)
