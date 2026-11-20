// Summarize out/*/results.json into out/summary.json: per run, counts, classes
// rolled up by level, difference signatures, mutants and coverage.
//
// Usage: node summarize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const runs = {};
for (const dir of fs.readdirSync(OUT).sort()) {
  const file = path.join(OUT, dir, 'results.json');
  if (!fs.existsSync(file)) continue;
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  // level families: raw, read-after-write, live, fresh, caller, staleness, mutation-result
  const family = (level) => {
    if (level === 'raw') return 'raw read cases';
    if (level === 'mutation-result') return 'mutation results';
    if (level.endsWith(':staleness')) return 'live vs fresh staleness';
    if (level.endsWith(':caller')) return `callers (${level.split(':').at(-2)})`;
    return `readers (${level.split(':').at(-1)})`;
  };
  const byFamily = {};
  for (const [level, classes] of Object.entries(r.classes))
    for (const [cls, n] of Object.entries(classes)) {
      const f = (byFamily[family(level)] ??= {});
      f[cls] = (f[cls] ?? 0) + n;
    }
  const byPhase = {};
  for (const [level, classes] of Object.entries(r.classes)) {
    const phase = level.split(':')[0];
    const total = Object.values(classes).reduce((a, b) => a + b, 0);
    byPhase[phase] = (byPhase[phase] ?? 0) + total;
  }
  runs[dir] = {
    seed: r.config.seed,
    mutant: r.config.mutant || null,
    control: r.config.control,
    load: r.config.load,
    commit: r.commit,
    prHead: r.prHead,
    identicalToPrHeadOutsideProof: r.identicalToPrHeadOutsideProof,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    counts: r.counts,
    comparisonsByFamily: byFamily,
    comparisonsByPhase: byPhase,
    differenceSignatures: r.diffSignatures,
    mutantResult: r.mutant,
    settle: r.settle,
    staleness: r.staleness,
    visibility: r.visibility,
    traffic: r.traffic,
    load: r.load,
    volume: r.volume ?? null,
    ops: r.ops,
    rejections: r.rejections,
    coverage: r.coverage,
    harnessErrors: r.harnessErrors.length,
  };
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(runs, null, 2));
for (const [name, s] of Object.entries(runs)) {
  const sigs = Object.entries(s.differenceSignatures);
  console.log(`${name}: ${s.counts.sequences} seq, ${s.counts.steps} steps, ${s.counts.rawCases} raw, ${s.counts.readerComparisons} reader, ${s.counts.callerComparisons} caller; ${sigs.length} signatures; harness errors ${s.harnessErrors}${s.mutant ? `; mutant applied ${s.mutantResult.applied}, caught ${s.mutantResult.firstCatch ? 'yes' : 'NO'}` : ''}`);
}
