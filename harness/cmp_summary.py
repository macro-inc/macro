#!/usr/bin/env python3
"""Old (channels-perf) vs new (channels-perf-b) medians for the interleaved runs."""
import json, sys
from pathlib import Path
OLD = Path.home()/".cache/channels-perf/results"; NEW = Path.home()/".cache/channels-perf-b/results"
def q(xs,p):
    xs=sorted(x for x in xs if isinstance(x,(int,float)))
    if not xs: return None
    pos=(len(xs)-1)*p; lo=int(pos); hi=min(lo+1,len(xs)-1)
    return xs[lo]+(xs[hi]-xs[lo])*(pos-lo)
def load(f):
    if not f.exists(): return None
    out={}
    for r in json.loads(f.read_text())["records"]:
        k=(r["phase"],r["size"]); o=out.setdefault(k,{"fp":[],"fin":[],"err":0,"req":[],"bytes":[]})
        if r.get("error") or r.get("timedOut"): o["err"]+=1; continue
        o["fp"].append(r.get("firstPaintMs"))
        o["fin"].append(r.get("targetHighlightedMs") if r.get("targetHighlightedMs") is not None else r.get("settledMs"))
        o["req"].append(r["requests"]["startedBeforeFirstPaint"]); o["bytes"].append(r["requests"]["bytesBeforeFirstPaint"])
    return out
f=lambda v: "–" if v is None else f"{v:.0f}"
names=sys.argv[1:] or ["cold_fresh-cmp","cold_login-cmp","session-cmp","jump_old-cmp","jump_reply-cmp","cold_fresh-throttled-cmp","session-throttled-cmp","session-cmp-prewarmed","session-throttled-cmp-prewarmed"]
print("| scenario | phase | size | n old/new (err) | first paint old | new | Δ | final old | new | Δ | reqs before paint old/new | bytes before paint old/new |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
res={}
for n in names:
    a,b=load(OLD/f"{n}.json"),load(NEW/f"{n}.json")
    if not a or not b: print(f"| {n} | NOT RUN | | | | | | | | | | |"); continue
    for k in a:
        if k not in b: continue
        x,y=a[k],b[k]
        fo,fn_=q(x["fp"],.5),q(y["fp"],.5); go,gn=q(x["fin"],.5),q(y["fin"],.5)
        d=lambda o,n_: "–" if o is None or n_ is None else f"{(n_-o)/o*100:+.0f}%"
        print(f"| {n} | {k[0]} | {k[1]} | {len(x['fp'])}/{len(y['fp'])} ({x['err']}/{y['err']}) | {f(fo)} | {f(fn_)} | {d(fo,fn_)} | {f(go)} | {f(gn)} | {d(go,gn)} | {f(q(x['req'],.5))}/{f(q(y['req'],.5))} | {f(q(x['bytes'],.5))}/{f(q(y['bytes'],.5))} |")
        res[f"{n}/{k[0]}/{k[1]}"]={"old":{"fp":fo,"fin":go,"fp90":q(x["fp"],.9)},"new":{"fp":fn_,"fin":gn,"fp90":q(y["fp"],.9)}}
(NEW/"cmp_summary.json").write_text(json.dumps(res,indent=1))
