// LOCAL ONLY (draft-prompt): per-call numbers for the three-way run. Never commit.
import { readFileSync } from 'node:fs';
import { summary, quantile } from './report';
const dir = process.argv[2];
const med = (v: number[]) => quantile(v, 0.5);
const rows: Record<string, unknown>[] = [];
const ARMS = (process.env.ARMS ?? 'S,T,D,F').split(',');
const [lo, hi] = (process.env.ROUNDS ?? '1-99').split('-').map(Number);
for (const arm of ARMS) {
  try { readFileSync(`${dir}/${arm}.draft.json`); } catch { continue; }
  const r = JSON.parse(readFileSync(`${dir}/${arm}.draft.json`, 'utf8'));
  const since = process.env.SINCE ? Date.parse(process.env.SINCE) : 0;
  const a = (r.attempts as any[]).filter((x) => x.round >= lo && x.round <= hi && Date.parse(x.startedAt) >= since);
  if (!a.length) continue;
  const b = a.filter((x) => x.breakdown && x.breakdown.modelCalls > 0).map((x) => x.breakdown);
  const s = summary(a);
  rows.push({
    arm,
    n: a.length,
    median: +(s.median / 1000).toFixed(1),
    p90: +(s.p90 / 1000).toFixed(1),
    worst: +(s.worst / 1000).toFixed(1),
    under15: Math.round(s.under * 100),
    everyCheck: Math.round(s.quality * 100),
    mechanical: Math.round(s.mechanical * 100),
    runs: Math.round(s.runs * 100),
    judge: +s.judge.toFixed(2),
    judgePass: Math.round(s.judgePass * 100),
    noDraft: s.noDraft,
    calls: s.modelCalls,
    callsMean: +(b.reduce((t, x) => t + x.modelCalls, 0) / b.length).toFixed(2),
    modelS: +(s.model / 1000).toFixed(1),
    perCallS: +(med(b.map((x) => x.modelMs / x.modelCalls)) / 1000).toFixed(2),
    ttftS: +(s.firstToken / 1000).toFixed(2),
    inPerDraftK: Math.round(s.inputTokens / 1000),
    inPerCallK: Math.round(med(b.map((x) => x.inputTokens / x.modelCalls)) / 1000),
    firstCallInK: undefined,
    outPerDraft: Math.round(s.outputTokens),
    outPerCall: Math.round(med(b.map((x) => x.outputTokens / x.modelCalls))),
    toolWaitS: +(s.toolWait / 1000).toFixed(1),
    setupS: +(s.setup / 1000).toFixed(1),
    tailS: +(s.tail / 1000).toFixed(1),
    load: s.load,
  });
}
console.log(JSON.stringify(rows, null, 1));
