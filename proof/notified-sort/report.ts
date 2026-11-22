// Collects every run under out/ into out/report.json: counts, coverage, each
// difference class with the closure that explains it (recomputed from
// lib/closed.ts, so a closure added later applies to earlier runs), and the
// classes nothing explains. A mutant run passes when it has open classes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSURES, closureOf } from './lib/closed.ts';

type ClassEntry = { n: number; example: unknown };
type RefEntry = { 'ref-agrees': number; 'ref-disagrees': number; 'ref-absent': number; example: unknown };

const outDir = join(import.meta.dirname, 'out');
const runs = readdirSync(outDir).filter((name) => existsSync(join(outDir, name, 'summary.json')));
const report: Record<string, unknown> = {};
for (const run of runs.sort()) {
  const summary = JSON.parse(readFileSync(join(outDir, run, 'summary.json'), 'utf8'));
  const refByClass: Record<string, RefEntry> = summary.reads?.reference?.byClass ?? {};
  const open: Record<string, ClassEntry & { phase: string }> = {};
  const closedBy: Record<string, number> = {};
  for (const phase of ['reads', 'dom', 'sequences']) {
    const classes: Record<string, ClassEntry> = summary[phase]?.classes ?? {};
    for (const [cls, entry] of Object.entries(classes)) {
      const closure = closureOf(cls);
      const refused = closure?.needsRefAgreement && (refByClass[cls]?.['ref-disagrees'] ?? 0) > 0;
      if (closure && !refused) closedBy[closure.id] = (closedBy[closure.id] ?? 0) + entry.n;
      else open[`${phase}: ${cls}${refused ? ' (main GraphQL disagrees)' : ''}`] = { phase, n: entry.n, example: entry.example };
    }
  }
  report[run] = {
    seed: summary.seed,
    mutant: summary.mutant,
    load: summary.load,
    loadCounts: summary.loadCounts,
    minutes: Math.round(summary.ms / 60000),
    reads: summary.reads && { cases: summary.reads.cases, compared: summary.reads.compared, probeErrors: summary.reads.probeErrors, coverage: summary.reads.coverage, refTransports: summary.reads.reference?.transports },
    dom: summary.dom && { compared: summary.dom.compared, coverage: summary.dom.coverage },
    sequences: summary.sequences && { sequences: summary.sequences.sequences, steps: summary.sequences.steps, stepOutcomes: summary.sequences.stepOutcomes, live: summary.sequences.live, storageResets: summary.sequences.storageResets, liveReopens: summary.sequences.liveReopens },
    retries: summary.retries ?? {},
    closedBy,
    open,
  };
  const verdict = summary.mutant ? (Object.keys(open).length ? 'CAUGHT' : 'MISSED') : Object.keys(open).length ? 'OPEN DIFFERENCES' : 'clean';
  console.log(`${run}: ${verdict}; reads ${summary.reads?.compared ?? 0}, dom ${summary.dom?.compared ?? 0}, sequences ${summary.sequences?.sequences ?? 0} x steps ${summary.sequences?.steps ?? 0}; closed ${JSON.stringify(closedBy)}; open ${Object.keys(open).length}`);
  for (const [cls, entry] of Object.entries(open).slice(0, 12)) console.log(`  open ${entry.n}x ${cls}`);
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ closures: CLOSURES.map((c) => ({ ...c, match: String(c.match) })), runs: report }, null, 1));
