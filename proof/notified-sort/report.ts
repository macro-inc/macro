// Collects every run under out/ into out/report.json: counts, coverage, each
// difference class with the closure that explains it (recomputed from
// lib/closed.ts, so a closure added later applies to earlier runs), and the
// classes nothing explains. A mutant run passes when it has open classes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSURES, closureOf } from './lib/closed.ts';
import { heldApartFromShared, type CompactDom, onlyStaleTimeLabels } from './lib/dom-held.ts';

type ClassEntry = { n: number; example: unknown };
type RefEntry = { 'ref-agrees': number; 'ref-disagrees': number; 'ref-absent': number; example: unknown };

type StepRecord = { lane: string; step: number; checks?: { dom?: { classes: string[] }; domRows?: CompactDom; domReload?: { sides: string[]; newHeld: boolean } } };

/**
 * A run recorded before lib/dom-held.ts judged a mounted Home held only when it
 * matched its reload whole, so one row both sides kept alike left main's own
 * lag open. Applies today's rule to the rows each such step recorded and moves
 * its open Home classes to `dom:old-behind-reload`, as run.ts now does live.
 * A run made with the rule already finds nothing to move.
 *
 * It also moves a Home check whose mounted sides differ only in relative-time
 * labels, each no older than its reload's (lib/dom-held.ts onlyStaleTimeLabels),
 * to `dom:stale-time-label` (closure L1).
 */
function reclassifyHeldDom(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; from: string[]; to: string; shared: string[] }[] {
  const path = join(outDir, run, 'steps.jsonl');
  if (!existsSync(path)) return [];
  const moved: { lane: string; step: number; from: string[]; to: string; shared: string[] }[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as StepRecord;
    const c = step.checks;
    if (!c?.dom || !c.domRows || !c.domReload || c.domReload.newHeld) continue;
    const open = c.dom.classes.filter((cls) => !closureOf(cls));
    if (!open.length || !c.domReload.sides.every((cls) => closureOf(cls))) continue;
    const held = heldApartFromShared(c.domRows);
    // The mounted sides differ only in when each last rendered a row's
    // relative-time label (closure L1): no row, order or text apart.
    const labels = !held.newHeld && open.every((cls) => cls.endsWith(' dom:text')) && onlyStaleTimeLabels(c.domRows);
    if (!held.newHeld && !labels) continue;
    for (const cls of open) {
      const entry = classes[cls];
      if (!entry) continue;
      entry.n -= 1;
      if (entry.n <= 0) delete classes[cls];
    }
    const to = open[0].replace(/ dom:.*$/, labels ? ' dom:stale-time-label' : ' dom:old-behind-reload');
    classes[to] ??= { n: 0, example: { lane: step.lane, step: step.step, from: open } };
    classes[to].n += 1;
    moved.push({ lane: step.lane, step: step.step, from: open, to, shared: held.shared });
  }
  return moved;
}

const outDir = join(import.meta.dirname, 'out');
const runs = readdirSync(outDir).filter((name) => existsSync(join(outDir, name, 'summary.json')));
const report: Record<string, unknown> = {};
for (const run of runs.sort()) {
  const summary = JSON.parse(readFileSync(join(outDir, run, 'summary.json'), 'utf8'));
  const refByClass: Record<string, RefEntry> = summary.reads?.reference?.byClass ?? {};
  const open: Record<string, ClassEntry & { phase: string }> = {};
  const closedBy: Record<string, number> = {};
  const reclassified = summary.sequences?.classes ? reclassifyHeldDom(run, summary.sequences.classes) : [];
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
    reclassified,
    closedBy,
    open,
  };
  const verdict = summary.mutant ? (Object.keys(open).length ? 'CAUGHT' : 'MISSED') : Object.keys(open).length ? 'OPEN DIFFERENCES' : 'clean';
  console.log(`${run}: ${verdict}; reads ${summary.reads?.compared ?? 0}, dom ${summary.dom?.compared ?? 0}, sequences ${summary.sequences?.sequences ?? 0} x steps ${summary.sequences?.steps ?? 0}; closed ${JSON.stringify(closedBy)}; open ${Object.keys(open).length}${reclassified.length ? `; ${reclassified.length} Home check(s) reclassified by lib/dom-held.ts` : ''}`);
  for (const [cls, entry] of Object.entries(open).slice(0, 12)) console.log(`  open ${entry.n}x ${cls}`);
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ closures: CLOSURES.map((c) => ({ ...c, match: String(c.match) })), runs: report }, null, 1));
