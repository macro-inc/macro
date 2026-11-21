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
  if (!fs.existsSync(file)) {
    // a run that started here but never wrote a result
    if (fs.existsSync(path.join(OUT, dir, 'started'))) runs[dir] = { verdict: null, incomplete: 'no results written' };
    continue;
  }
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // removed by a run starting in this directory, between the check and the read
    runs[dir] = { verdict: null, incomplete: 'results unreadable' };
    continue;
  }
  // level families: raw (by phase), write replay, imperative, mutation results, readers, callers, staleness
  const family = (level) => {
    if (level.startsWith('raw:')) return `raw read cases (${level.slice(4)})`;
    if (level === 'write-replay') return 'write replay';
    if (level === 'imperative') return 'imperative read';
    if (level === 'visibility') return 'visibility after create/delete';
    if (level === 'settle') return 'live-update bound';
    if (level === 'page-errors') return 'uncaught page errors';
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
    // raw read cases keep their phase (sweep, random-read, read-after-write, ...)
    const phase = level.startsWith('raw:') ? level : level.split(':')[0];
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
    // null: the run never reached its final checks (crashed, killed, or still running)
    verdict: r.verdict ?? null,
    counts: r.counts,
    comparisonsByFamily: byFamily,
    comparisonsByPhase: byPhase,
    differenceSignatures: r.diffSignatures,
    mutantResult: r.mutant,
    settle: r.settle,
    staleness: r.staleness,
    visibility: r.visibility,
    traffic: r.traffic,
    otherWrites: r.otherWrites,
    pageErrors: r.pageErrors,
    sqlFailures: r.sqlFailures,
    sqlRefusals: r.sqlRefusals ?? {},
    collation: r.collation && { strings: r.collation.strings, skippedWithNul: r.collation.skippedWithNul, mismatches: r.collation.mismatches?.length ?? null, error: r.collation.error ?? null },
    load: r.load,
    volume: r.volume ?? null,
    ops: r.ops,
    rejections: r.rejections,
    coverage: r.coverage,
    totals: r.totals,
    moduleChecks: r.moduleChecks,
    crashes: r.crashes,
    harnessErrors: r.totals?.harnessErrors ?? r.harnessErrors.length,
  };
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(runs, null, 2));
for (const [name, s] of Object.entries(runs)) {
  if (s.incomplete) {
    console.log(`${name} [INCOMPLETE]: ${s.incomplete}`);
    continue;
  }
  const sigs = Object.entries(s.differenceSignatures);
  const verdict = s.verdict ? (s.verdict.passed ? 'PASSED' : `FAILED (${s.verdict.failures.join('; ')})`) : 'INCOMPLETE';
  console.log(`${name} [${verdict}] at ${s.commit}: ${s.counts.sequences} seq, ${s.counts.steps} steps, ${s.counts.rawCases} raw, ${s.counts.readerComparisons} reader, ${s.counts.callerComparisons} caller; ${sigs.length} signatures; ${s.totals?.differences ?? '?'} differences; harness errors ${s.harnessErrors}; crashes ${s.crashes?.length ?? 0}${s.mutant ? `; mutant applied ${s.mutantResult.applied}, caught ${s.mutantResult.firstCatch ? 'yes' : 'NO'}` : ''}`);
}
