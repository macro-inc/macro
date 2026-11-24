// Collects every run under out/ into out/report.json: counts, coverage, each
// difference class with the closure that explains it (recomputed from
// lib/closed.ts, so a closure added later applies to earlier runs), and the
// classes nothing explains. A mutant run passes when it has open classes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLOSURES, closureOf } from './lib/closed.ts';
import { channelNameRest, homeCheckClosure, type CompactDom } from './lib/dom-held.ts';
import { authRefreshTimeoutClass, TRANSPORT_FAILURE } from './lib/compare.ts';
import { pastLoadedPages, REST_DEADLINE, staleSlotPastPages, type Row } from './lib/project.ts';

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
 * to `dom:stale-time-label` (closure L1), and one whose older labels are all
 * on mail rows to `dom:stale-mail-label` (closure E1); lib/dom-held.ts
 * homeCheckClosure judges all three.
 */
function reclassifyHeldDom(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; from: string[]; to: string; shared: string[]; mail: unknown[] }[] {
  const path = join(outDir, run, 'steps.jsonl');
  if (!existsSync(path)) return [];
  const moved: { lane: string; step: number; from: string[]; to: string; shared: string[]; mail: unknown[] }[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as StepRecord;
    const c = step.checks;
    if (!c?.dom || !c.domRows || !c.domReload || c.domReload.newHeld) continue;
    const open = c.dom.classes.filter((cls) => !closureOf(cls));
    if (!open.length || !c.domReload.sides.every((cls) => closureOf(cls))) continue;
    const judged = homeCheckClosure(c.domRows, open);
    if (!judged) continue;
    for (const cls of open) {
      const entry = classes[cls];
      if (!entry) continue;
      entry.n -= 1;
      if (entry.n <= 0) delete classes[cls];
    }
    const to = open[0].replace(/ dom:.*$/, ` ${judged.suffix}`);
    classes[to] ??= { n: 0, example: { lane: step.lane, step: step.step, from: open } };
    classes[to].n += 1;
    moved.push({ lane: step.lane, step: step.step, from: open, to, shared: judged.held.shared, mail: judged.mail });
  }
  return moved;
}

/**
 * A run recorded before compare.ts named a session refresh that gave up
 * (closure T10) kept it as a plain `error:old` or `error:new`. Moves each
 * reload error whose recorded detail (`checks.reload<i>errors`) is that
 * timeout to its named class, as compareSnapshots now does live.
 */
function reclassifyAuthTimeouts(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; from: string; to: string }[] {
  const path = join(outDir, run, 'steps.jsonl');
  if (!existsSync(path)) return [];
  const moved: { lane: string; step: number; from: string; to: string }[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as { lane: string; step: number; checks?: Record<string, unknown> };
    for (const [key, value] of Object.entries(step.checks ?? {})) {
      const m = /^reload(\d+)$/.exec(key);
      if (!m || !Array.isArray(value)) continue;
      const details = (step.checks?.[`reload${m[1]}errors`] as string[] | undefined) ?? [];
      for (const from of value as string[]) {
        const to = authRefreshTimeoutClass(from, details);
        const entry = classes[from];
        if (to === from || !entry) continue;
        entry.n -= 1;
        if (entry.n <= 0) delete classes[from];
        classes[to] ??= { n: 0, example: { lane: step.lane, step: step.step, from, details } };
        classes[to].n += 1;
        moved.push({ lane: step.lane, step: step.step, from, to });
      }
    }
  }
  return moved;
}

/**
 * A DOM-phase read recorded before lib/dom.ts set a thread row's channel name
 * aside (closure N1) stopped at that row: compareDom reports the first
 * positional difference only. Moves each such `dom:text` to
 * `dom:channel-name-snapshot:rest-unrecorded`, which N1 closes on the
 * evidence of dbg-channel-name.ts, a re-read of the same world compared whole.
 */
function reclassifyDomNames(run: string, classes: Record<string, ClassEntry>): { job: unknown; from: string; to: string; names: string }[] {
  const path = join(outDir, run, 'dom.jsonl');
  if (!existsSync(path)) return [];
  const moved: { job: unknown; from: string; to: string; names: string }[] = [];
  type Row = { kind: string; id: string; text: string };
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const rec = JSON.parse(line) as { job: unknown; diffs?: { cls: string; old?: Row; new?: Row }[] };
    for (const d of rec.diffs ?? []) {
      if (!/ dom:text$/.test(d.cls) || d.old?.kind !== 'entity' || d.new?.kind !== 'entity' || d.old.id !== d.new.id || !d.old.id.includes('|s14:channel_thread|')) continue;
      const rest = channelNameRest(d.old.text, d.new.text);
      if (rest === null) continue;
      const entry = classes[d.cls];
      if (!entry) continue;
      entry.n -= 1;
      if (entry.n <= 0) delete classes[d.cls];
      const to = d.cls.replace(/ dom:text$/, ' dom:channel-name-snapshot:rest-unrecorded');
      const names = `old "${d.old.text.slice(0, d.old.text.length - rest.length)}" new "${d.new.text.slice(0, d.new.text.length - rest.length)}"`;
      classes[to] ??= { n: 0, example: { job: rec.job, from: d.cls, names } };
      classes[to].n += 1;
      moved.push({ job: rec.job, from: d.cls, to, names });
    }
  }
  return moved;
}

/**
 * A run recorded before run.ts named a mounted list that holds only the pages
 * it loaded (closure P3) kept it as `live:<tag>:new-not-within-bound`. Moves
 * each such miss whose evidence (checks.liveRows), the mounted list's state
 * as the reopen recorded it (checks.reopened: pages, hasNextPage) and the
 * spec's page size (sequences.jsonl) show it, as run.ts now does live: every
 * new-side token is a missing row, and the list's rows are full pages that
 * equal the fresh read's first rows (lib/project.ts pastLoadedPages).
 */
function reclassifyPastPages(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; spec: number; from: string; to: string }[] {
  const stepsPath = join(outDir, run, 'steps.jsonl');
  const seqPath = join(outDir, run, 'sequences.jsonl');
  if (!existsSync(stepsPath) || !existsSync(seqPath)) return [];
  type Spec = { params?: { limit?: number }; groupBy?: unknown };
  type Evidence = { spec: number; pastPages?: boolean; newLive: string[]; newFresh: string[] };
  type Reopen = { spec: number; side: string; state?: { pages: number; hasNextPage: boolean } };
  const specsOf = new Map<string, Spec[]>();
  for (const line of readFileSync(seqPath, 'utf8').split('\n').filter(Boolean)) {
    const seq = JSON.parse(line) as { lane: string; sequence: number; specs?: Spec[] };
    specsOf.set(`${seq.lane}/${seq.sequence}`, seq.specs ?? []);
  }
  const rows = (compact: string[]): Row[] =>
    compact.map((c) => {
      const at = c.lastIndexOf('@');
      const n = c.slice(at + 1);
      return { key: c.slice(0, at), notifiedAt: n === '-' ? null : n, name: null };
    });
  const moved: { lane: string; step: number; spec: number; from: string; to: string }[] = [];
  for (const line of readFileSync(stepsPath, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as { lane: string; sequence: number; step: number; checks?: { liveRows?: Evidence[]; liveMisses?: string[]; reopened?: Reopen[] } };
    for (const ev of step.checks?.liveRows ?? []) {
      // Recorded by run.ts with the rule already applied.
      if (ev.pastPages !== undefined) continue;
      const spec = specsOf.get(`${step.lane}/${step.sequence}`)?.[ev.spec];
      if (!spec || spec.groupBy) continue;
      const tag = ev.spec < 2 ? 'home' : 'random';
      const prefix = `spec${ev.spec} new `;
      const misses = (step.checks?.liveMisses ?? []).find((m) => m.startsWith(prefix));
      const tokens = misses ? misses.slice(prefix.length).split(' ').map((t) => t.replace(/<.*$/, '')) : [];
      if (!tokens.length || !tokens.every((t) => t.startsWith('missing:'))) continue;
      const state = step.checks?.reopened?.find((r) => r.spec === ev.spec && r.side === 'new')?.state;
      if (!state || !pastLoadedPages(rows(ev.newLive), rows(ev.newFresh), state, Number(spec.params?.limit) || undefined)) continue;
      const from = Object.keys(classes).find((cls) => cls === `live:${tag}:new-not-within-bound` || cls.startsWith(`live:${tag}:new-not-within-bound:`));
      if (!from) continue;
      const entry = classes[from];
      entry.n -= 1;
      if (entry.n <= 0) delete classes[from];
      const to = from.replace('new-not-within-bound', 'new-past-loaded-pages');
      classes[to] ??= { n: 0, example: { lane: step.lane, sequence: step.sequence, step: step.step, spec: ev.spec, state } };
      classes[to].n += 1;
      moved.push({ lane: step.lane, step: step.step, spec: ev.spec, from, to });
    }
  }
  return moved;
}

/**
 * A run recorded before run.ts named two more kinds of new-side miss kept them
 * as `live:<tag>:new-not-within-bound`. Moves each miss whose evidence
 * (checks.liveRows, checks.liveMisses) shows one, as run.ts now does live:
 * - `new-rest-deadline` (closure T11): the branch's list was on REST and its
 *   last state was main's 12 s deadline error (lib/project.ts REST_DEADLINE);
 * - `new-past-loaded-pages-behind-alike` (closure P4): every new-side token
 *   is a missing row or an extra row main's mounted list shows too, and the
 *   list is full pages whose other rows are the fresh read's first rows
 *   (lib/project.ts staleSlotPastPages, on the recorded key@notifiedAt rows).
 */
function reclassifyLiveSlots(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; spec: number; from: string; to: string }[] {
  const stepsPath = join(outDir, run, 'steps.jsonl');
  const seqPath = join(outDir, run, 'sequences.jsonl');
  if (!existsSync(stepsPath) || !existsSync(seqPath)) return [];
  type Spec = { groupBy?: unknown };
  type Evidence = { spec: number; pastPages?: boolean; behindAlike?: boolean; newMeta?: string; newPaging?: { pages: number; hasNextPage: boolean }; limit?: number; oldLive: string[]; newLive: string[]; newFresh: string[] };
  const specsOf = new Map<string, Spec[]>();
  for (const line of readFileSync(seqPath, 'utf8').split('\n').filter(Boolean)) {
    const seq = JSON.parse(line) as { lane: string; sequence: number; specs?: Spec[] };
    specsOf.set(`${seq.lane}/${seq.sequence}`, seq.specs ?? []);
  }
  const rows = (compact: string[]): Row[] =>
    compact.map((c) => {
      const at = c.lastIndexOf('@');
      const n = c.slice(at + 1);
      return { key: c.slice(0, at), notifiedAt: n === '-' ? null : n, name: null };
    });
  const tokensOf = (misses: string[], prefix: string) => {
    const line = misses.find((m) => m.startsWith(prefix));
    return line ? line.slice(prefix.length).split(' ').map((t) => t.replace(/<.*$/, '')) : [];
  };
  const moved: { lane: string; step: number; spec: number; from: string; to: string }[] = [];
  for (const line of readFileSync(stepsPath, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as { lane: string; sequence: number; step: number; checks?: { liveRows?: Evidence[]; liveMisses?: string[] } };
    for (const ev of step.checks?.liveRows ?? []) {
      // Recorded by run.ts with the rules already applied, or already named P3.
      if (ev.behindAlike !== undefined || ev.pastPages) continue;
      const spec = specsOf.get(`${step.lane}/${step.sequence}`)?.[ev.spec];
      if (!spec) continue;
      const tag = spec.groupBy ? 'grouped' : ev.spec < 2 ? 'home' : 'random';
      const misses = step.checks?.liveMisses ?? [];
      const newTokens = tokensOf(misses, `spec${ev.spec} new `);
      const oldTokens = tokensOf(misses, `spec${ev.spec} old `);
      let name: string | null = null;
      if (REST_DEADLINE.test(ev.newMeta ?? '')) name = 'new-rest-deadline';
      else if (!spec.groupBy && newTokens.length && newTokens.every((t) => t.startsWith('missing:') || (t.startsWith('extra:') && oldTokens.includes(t)))) {
        const stale = staleSlotPastPages(rows(ev.newLive), rows(ev.newFresh), rows(ev.oldLive), ev.newPaging ?? null, ev.limit);
        if (stale && newTokens.filter((t) => t.startsWith('extra:')).every((t) => stale.some((r) => `extra:${r.key}` === t))) name = 'new-past-loaded-pages-behind-alike';
      }
      if (!name) continue;
      const from = `live:${tag}:new-not-within-bound`;
      const entry = classes[from];
      if (!entry) continue;
      entry.n -= 1;
      if (entry.n <= 0) delete classes[from];
      const to = `live:${tag}:${name}`;
      classes[to] ??= { n: 0, example: { lane: step.lane, sequence: step.sequence, step: step.step, spec: ev.spec, newMeta: ev.newMeta, newPaging: ev.newPaging, limit: ev.limit } };
      classes[to].n += 1;
      moved.push({ lane: step.lane, step: step.step, spec: ev.spec, from, to });
    }
  }
  return moved;
}

/**
 * A run recorded before compare.ts named a transport failure (closure T12)
 * kept it as a plain `error:old` or `error:new`. Moves each raw or reload
 * error whose recorded detail (`old=<error> new=<error>`) shows the failing
 * side's fetch rejected in transport to `<class>:network`, as
 * compareSnapshots now does live.
 */
function reclassifyNetwork(run: string, classes: Record<string, ClassEntry>): { lane: string; step: number; from: string; to: string; detail: string }[] {
  const path = join(outDir, run, 'steps.jsonl');
  if (!existsSync(path)) return [];
  const moved: { lane: string; step: number; from: string; to: string; detail: string }[] = [];
  const failingMessage = (cls: string, detail: string) => {
    const m = /^old=(.*) new=(.*)$/s.exec(detail);
    if (!m) return null;
    return / error:old$|^error:old$/.test(cls) ? m[1] : m[2];
  };
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const step = JSON.parse(line) as { lane: string; step: number; checks?: Record<string, unknown> };
    for (const [key, value] of Object.entries(step.checks ?? {})) {
      let pairs: [string, string][] = [];
      if (/^raw\d+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        const raw = value as { classes?: string[]; errors?: string[] };
        const errs = (raw.classes ?? []).filter((c) => /(^|\s)error:(old|new)$/.test(c));
        pairs = errs.map((c, i) => [c, raw.errors?.[i] ?? '']);
      } else if (/^reload\d+$/.test(key) && Array.isArray(value)) {
        const details = (step.checks?.[`${key}errors`] as string[] | undefined) ?? [];
        const errs = (value as string[]).filter((c) => /(^|\s)error:(old|new)$/.test(c));
        pairs = errs.map((c, i) => [c, details[i] ?? '']);
      }
      for (const [from, detail] of pairs) {
        const message = failingMessage(from, detail);
        if (message === null || !TRANSPORT_FAILURE.test(message)) continue;
        const entry = classes[from];
        if (!entry) continue;
        entry.n -= 1;
        if (entry.n <= 0) delete classes[from];
        const to = `${from}:network`;
        classes[to] ??= { n: 0, example: { lane: step.lane, step: step.step, from, detail } };
        classes[to].n += 1;
        moved.push({ lane: step.lane, step: step.step, from, to, detail });
      }
    }
  }
  return moved;
}

const outDir

 = join(import.meta.dirname, 'out');
/**
 * Phases of a run that a later run replaces. The loaded run on seed 3702 read
 * while its notifiers wrote to the same viewers and kept no write window, so
 * its reads and Home checks cannot tell the race from the readers
 * (chk-load-race.ts shows the race in every notification-time difference it
 * recorded); run load-reads (seed 3703) repeats both phases under the same
 * load, recording each read's window (lib/race.ts). Their classes are listed
 * as superseded, never as closed.
 */
const SUPERSEDED: Record<string, { phases: string[]; by: string }> = { load: { phases: ['reads', 'dom'], by: 'load-reads' } };
const runs = readdirSync(outDir).filter((name) => existsSync(join(outDir, name, 'summary.json')));
const report: Record<string, unknown> = {};
for (const run of runs.sort()) {
  const summary = JSON.parse(readFileSync(join(outDir, run, 'summary.json'), 'utf8'));
  const refByClass: Record<string, RefEntry> = summary.reads?.reference?.byClass ?? {};
  const open: Record<string, ClassEntry & { phase: string }> = {};
  const closedBy: Record<string, number> = {};
  // A read the probe could not make on a side (the page threw, or its query
  // never settled) compared nothing: counted as not compared, never closed.
  const uncompared: Record<string, number> = {};
  const reclassified = summary.sequences?.classes ? reclassifyHeldDom(run, summary.sequences.classes) : [];
  const authTimeouts = summary.sequences?.classes ? reclassifyAuthTimeouts(run, summary.sequences.classes) : [];
  const domNames = summary.dom?.classes ? reclassifyDomNames(run, summary.dom.classes) : [];
  const pastPages = summary.sequences?.classes ? reclassifyPastPages(run, summary.sequences.classes) : [];
  const liveSlots = summary.sequences?.classes ? reclassifyLiveSlots(run, summary.sequences.classes) : [];
  const network = summary.sequences?.classes ? reclassifyNetwork(run, summary.sequences.classes) : [];
  const superseded: Record<string, number> = {};
  for (const phase of ['reads', 'dom', 'sequences']) {
    const classes: Record<string, ClassEntry> = summary[phase]?.classes ?? {};
    if (SUPERSEDED[run]?.phases.includes(phase)) {
      for (const [cls, entry] of Object.entries(classes)) superseded[`${phase}: ${cls}`] = entry.n;
      continue;
    }
    for (const [cls, entry] of Object.entries(classes)) {
      if (cls.startsWith('probe-error:')) {
        uncompared[cls] = (uncompared[cls] ?? 0) + entry.n;
        continue;
      }
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
    authTimeouts,
    domNames,
    pastPages,
    liveSlots,
    network,
    supersededBy: SUPERSEDED[run]?.by,
    supersededPhases: SUPERSEDED[run]?.phases,
    superseded,
    closedBy,
    uncompared,
    open,
  };
  const verdict = summary.mutant ? (Object.keys(open).length ? 'CAUGHT' : 'MISSED') : Object.keys(open).length ? 'OPEN DIFFERENCES' : 'clean';
  console.log(`${run}: ${verdict}; reads ${summary.reads?.compared ?? 0}, dom ${summary.dom?.compared ?? 0}, sequences ${summary.sequences?.sequences ?? 0} x steps ${summary.sequences?.steps ?? 0}; uncompared ${JSON.stringify(uncompared)}; closed ${JSON.stringify(closedBy)}; open ${Object.keys(open).length}${reclassified.length ? `; ${reclassified.length} Home check(s) reclassified by lib/dom-held.ts` : ''}`);
  for (const [cls, entry] of Object.entries(open).slice(0, 12)) console.log(`  open ${entry.n}x ${cls}`);
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ closures: CLOSURES.map((c) => ({ ...c, match: String(c.match) })), runs: report }, null, 1));
