#!/usr/bin/env python3
"""Summarise results/*.json into results/summary.md (tables) + results/summary.json."""
import json, glob, os, statistics as st
from pathlib import Path
H = Path(__file__).resolve().parent; import sys
R = H / "results" / sys.argv[1] if len(sys.argv) > 1 else H / "results"
def q(xs, p):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    if not xs: return None
    pos = (len(xs) - 1) * p; lo = int(pos); hi = min(lo + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo), 1)
def mp(xs):
    m, p = q(xs, .5), q(xs, .9)
    return "–" if m is None else f"{m:.0f} / {p:.0f}"
def med(xs):
    m = q(xs, .5); return "–" if m is None else f"{m:.0f}"
ORDER = ["cold_fresh", "cold_login", "session", "jump_old", "jump_reply", "cold_fresh-throttled", "cold_login-throttled", "session-throttled"]
out = []; summary = {}
for name in ORDER:
    f = R / f"{name}.json"
    if not f.exists(): out.append(f"\n### {name}: NOT RUN\n"); continue
    d = json.loads(f.read_text()); recs = d["records"]
    phases = []
    for r in recs:
        if r["phase"] not in phases: phases.append(r["phase"])
    for ph in phases:
        out.append(f"\n### {name} / {ph}\n")
        out.append("| size | n ok/err | first msg painted ms (med / p90) | settled-at-bottom or target-highlighted ms (med / p90) | DOM msgs | reqs started before paint | bytes before paint | reqs total | Task ms | Script ms | Layout ms | RecalcStyle ms | long tasks n / total ms | first API req start ms | static reqs / MB / from cache |")
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for size in ["small", "medium", "large"]:
            rs = [r for r in recs if r["phase"] == ph and r["size"] == size]
            ok = [r for r in rs if not r.get("error") and not r.get("timedOut")]
            bad = len(rs) - len(ok)
            g = lambda k: [r.get(k) for r in ok]
            fin = [r.get("targetHighlightedMs") if r.get("targetHighlightedMs") is not None else r.get("settledMs") for r in ok]
            cpu = lambda k: [r["cpuToSettle"][k] for r in ok]
            row = [size, f"{len(ok)}/{bad}", mp(g("firstPaintMs")), mp(fin), med(g("domMessages")),
                   med([r["requests"]["startedBeforeFirstPaint"] for r in ok]), med([r["requests"]["bytesBeforeFirstPaint"] for r in ok]),
                   med([r["requests"]["total"] for r in ok]), mp(cpu("taskMs")), med(cpu("scriptMs")), med(cpu("layoutMs")), med(cpu("recalcStyleMs")),
                   f'{med([r["longTasks"]["count"] for r in ok])} / {med([r["longTasks"]["totalMs"] for r in ok])}',
                   med([min([w["startMs"] for w in r["waterfall"] if w["type"] in ("Fetch", "XHR")] or [None]) for r in ok]),
                   f'{med([r["static"]["count"] for r in ok])} / {(q([r["static"]["bytes"] for r in ok], .5) or 0) / 1e6:.1f} / {med([r["static"]["fromDiskCache"] for r in ok])}']
            out.append("| " + " | ".join(row) + " |")
            summary[f"{name}/{ph}/{size}"] = {"n": len(ok), "errors": bad, "firstPaint": [q(g("firstPaintMs"), .5), q(g("firstPaintMs"), .9)], "final": [q(fin, .5), q(fin, .9)],
                "task": q(cpu("taskMs"), .5), "script": q(cpu("scriptMs"), .5), "layout": q(cpu("layoutMs"), .5), "static": {"count": q([r["static"]["count"] for r in ok], .5), "bytes": q([r["static"]["bytes"] for r in ok], .5), "fromDiskCache": q([r["static"]["fromDiskCache"] for r in ok], .5)}}
        errs = [r for r in recs if r["phase"] == ph and (r.get("error") or r.get("timedOut"))]
        for e in errs[:3]: out.append(f"\n- failed sample ({e['size']} #{e['i']}): `{(e.get('error') or 'timed out')[:200]}`")
def waterfall(name, ph, size="medium"):
    f = R / f"{name}.json"
    if not f.exists(): return
    recs = [r for r in json.loads(f.read_text())["records"] if r["phase"] == ph and r["size"] == size and not r.get("error")]
    if not recs: return
    recs.sort(key=lambda r: r["firstPaintMs"] if r.get("firstPaintMs") is not None else 1e9); r = recs[len(recs) // 2]
    fin = r.get("targetHighlightedMs") if r.get("targetHighlightedMs") is not None else r.get("settledMs")
    out.append(f"\n### Waterfall: {name} / {ph} / {size} (median sample #{r['i']}: first paint {r['firstPaintMs']} ms, final {fin} ms; static files: {r['static']['count']} requests, {r['static']['bytes']} bytes, {r['static']['fromDiskCache']} from disk cache, last finished at {r['static']['lastEndMs']} ms)\n")
    out.append("| # | start ms | ttfb ms | dur ms | bytes | status | request | before paint (started/finished) |")
    out.append("|---|---|---|---|---|---|---|---|")
    for i, w in enumerate(r["waterfall"], 1):
        label = f"{w['method']} {w['path'][:110]}" + (f" **{w['op']}**" if w.get("op") else "")
        out.append(f"| {i} | {w['startMs']} | {w['ttfbMs']} | {w['durationMs']} | {w['bytes']} | {w['status']} | `{label}` | {'yes' if w['startedBeforeFirstPaint'] else 'no'}/{'yes' if w['finishedBeforeFirstPaint'] else 'no'} |")
    ws = [f for f in r.get("wsFrames", []) if f["atMs"] <= (fin or 0) + 2500]
    if ws:
        out.append("\nWebSocket frames in the same window (pings dropped):\n")
        for f in ws[:20]: out.append(f"- {f['atMs']} ms {f['dir']} `{f['ws']}` {f['bytes']} B: `{f['preview'][:140]}`")
for a in [("cold_fresh", "cold_fresh"), ("cold_login", "cold_login"), ("session", "warm_switch"), ("session", "revisit"), ("session", "reload"), ("jump_old", "jump_old"), ("jump_reply", "jump_reply"), ("cold_fresh-throttled", "cold_fresh"), ("cold_login-throttled", "cold_login"), ("session-throttled", "warm_switch"), ("session-throttled", "revisit"), ("session-throttled", "reload")]:
    waterfall(*a)
(R / "summary.md").write_text("\n".join(out) + "\n"); (R / "summary.json").write_text(json.dumps(summary, indent=1))
print("\n".join(l for l in out if l.startswith("###") and "Waterfall" not in l or l.startswith("| s") or l.startswith("| m") or l.startswith("| l") or l.startswith("- failed"))[:6000])
