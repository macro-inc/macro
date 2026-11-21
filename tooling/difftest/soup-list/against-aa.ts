/**
 * Puts each sequence failure bucket of a run next to the A/A control's rate
 * for the same bucket: failures per 100 steps of that step kind, so a bucket
 * that also shows when main runs against itself reads as the harness's own
 * noise, and one that doesn't stands out.
 *
 *   bun run against-aa.ts results/aa.json results/quiet.json [results/load.json ...]
 */
type Json = Record<string, any>;
const [aaPath, ...runPaths] = process.argv.slice(2);
const load = async (p: string) => (await Bun.file(p).json()) as Json;
const buckets = (r: Json) => {
  const out: Record<string, number> = {};
  for (const f of r.sequences?.failures ?? []) {
    const step = String(f.detail ?? '').split(':')[0] || '?';
    const key = `${f.kind} | ${f.reader ?? '-'} | ${step}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};
const per100 = (n: number, r: Json, key: string) => {
  const step = key.split(' | ')[2];
  const steps = r.sequences?.stepKinds?.[step];
  return steps ? Math.round((n / steps) * 1000) / 10 : null;
};
const aa = await load(aaPath);
const aaB = buckets(aa);
const out: Json = {};
for (const p of runPaths) {
  const r = await load(p);
  const b = buckets(r);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(aaB)])].sort();
  out[r.meta?.label ?? p] = {
    steps: r.sequences?.steps,
    aaSteps: aa.sequences?.steps,
    buckets: Object.fromEntries(
      keys.map((k) => [k, { run: b[k] ?? 0, runPer100: per100(b[k] ?? 0, r, k), aa: aaB[k] ?? 0, aaPer100: per100(aaB[k] ?? 0, aa, k) }])
    ),
  };
}
console.log(JSON.stringify(out, null, 1));
