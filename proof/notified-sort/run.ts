// One differential run: seed a world, start main's app and the branch's app
// side by side on the same backend, then
//   1. reads:     generated read cases, both sides at once, compared in full;
//   2. dom:       Home as the viewer sees it, both sides, compared row by row;
//   3. sequences: random write sequences, after every step compared
//                 read-after-write, live (within LIVE_BOUND_MS) and after a
//                 reload, plus the on-screen Home list every few steps;
// optionally under concurrent load, optionally with one mutant planted in the
// branch's reader. Everything lands in out/<run>/ as JSONL plus summary.json.
//
// Configuration (environment): PROOF_SEED, PROOF_RUN, PROOF_LANES,
// PROOF_SIZES, PROOF_READS, PROOF_SEQUENCES, PROOF_STEPS, PROOF_WORKERS,
// PROOF_DOM, PROOF_LOAD, PROOF_MUTANT, PROOF_PHASES, PROOF_REUSE,
// PROOF_SEQ_CONCURRENCY, PROOF_SEQ_LANES.

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, STEP_WEIGHTS, type ActionContext, type StepKind } from './lib/actions.ts';
import {
  launchBrowser,
  onRequestFailure,
  openLane,
  probeOpenLive,
  probeLiveDebug,
  probeRead,
  probeSnapLive,
  readHomeDom,
  reloadLane,
  startApp,
  stopApp,
  type AppServer,
  type Lane,
  type ProbeResult,
  type RequestFailure,
  type ReadSpec,
} from './lib/browser.ts';
import { classify, sameInstant, type Classified } from './lib/classify.ts';
import { closureOf } from './lib/closed.ts';
import { compareSnapshots, entityKey, OLD_DEADLINE, refCheck, type DomRow } from './lib/compare.ts';
import { compareHomeDom } from './lib/dom.ts';
import { generateReads, type ReadCase } from './lib/gen.ts';
import { applyMutant, MUTANTS, revertMutant } from './lib/mutants.ts';
import { queueNotify } from './lib/notify.ts';
import { discrepancies, instant, project, rowsDiff, sameRows, type Row } from './lib/project.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld, sender } from './lib/setup.ts';
import { q, sql, stackFromEnv, type User } from './lib/stack.ts';
import type { Entity, World } from './lib/world.ts';

const env = process.env;
const seed = Number(env.PROOF_SEED ?? 1101);
const runName = env.PROOF_RUN ?? `s${seed}${env.PROOF_LOAD === '1' ? '-load' : ''}${env.PROOF_MUTANT ? `-${env.PROOF_MUTANT}` : ''}`;
const lanesCount = Number(env.PROOF_LANES ?? 8);
const sizes = (env.PROOF_SIZES ?? '0,1,100,101,2000').split(',').filter(Boolean).map(Number);
const readCount = Number(env.PROOF_READS ?? 2000);
const sequencesPerLane = Number(env.PROOF_SEQUENCES ?? 13);
const stepsPerSequence = Number(env.PROOF_STEPS ?? 20);
const workers = Number(env.PROOF_WORKERS ?? 6);
const domPerViewer = Number(env.PROOF_DOM ?? 6);
const load = env.PROOF_LOAD === '1';
const phases = new Set((env.PROOF_PHASES ?? 'reads,dom,sequences').split(','));
const LIVE_BOUND_MS = Number(env.PROOF_LIVE_BOUND_MS ?? 15_000);
const DOM_EVERY = Number(env.PROOF_DOM_EVERY ?? 5);
// Anchors the generated date filters; with the seed it fixes every read case.
const genNow = Number(env.PROOF_NOW ?? Date.now());

const here = import.meta.dirname;
const out = join(here, 'out', runName);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(join(out, 'run.log'), `${stamped}\n`);
};
const record = (file: string, value: unknown) => appendFileSync(join(out, file), `${JSON.stringify(value)}\n`);
const unexplained = new Map<string, number>();
const HOME_TYPES = ['documents', 'tasks', 'email', 'channels', 'agents', 'folders', 'initiatives', 'github', 'calendar'];

// A read that got no answer: the browser gave up on a request (the REST and
// GraphQL clients report it as these messages), or the probe never settled.
const NO_ANSWER = /Network error occurred|Failed to fetch|did not settle in time/;
const retries: Record<string, number> = {};
onRequestFailure((failure) => record('requestfailed.jsonl', failure));

const stack = stackFromEnv();
const viteEnv = {
  backendProxy: stack.proxyUrl,
  routes: env.PROOF_ROUTES ?? '',
  caPem: env.PROOF_CA_PEM ?? '',
  hostname: env.PROOF_HOSTNAME ?? 'localhost',
};
const oldWorktree = env.PROOF_OLD_WORKTREE ?? '';
const newWorktree = env.PROOF_NEW_WORKTREE ?? '';
const mutant = env.PROOF_MUTANT ? MUTANTS.find((m) => m.name === env.PROOF_MUTANT) : undefined;
if (env.PROOF_MUTANT && !mutant) throw new Error(`unknown mutant ${env.PROOF_MUTANT}`);

const started = Date.now();
log(`run ${runName}: seed ${seed}, lanes ${lanesCount}, sizes ${sizes.join('/')}, reads ${readCount}, sequences ${lanesCount}x${sequencesPerLane}x${stepsPerSequence}, load ${load}, mutant ${mutant?.name ?? 'none'}`);

const seeded = await seedWorld(stack, {
  seed,
  lanes: lanesCount,
  sizes,
  outDir: join(out, 'world'),
  repo: env.PROOF_REPO ?? '',
  instance: env.PROOF_INSTANCE ?? 'gqlns',
  log,
  reuse: env.PROOF_REUSE === '1',
});
const { world, users } = seeded;
const byId = new Map<string, Entity>();
for (const entity of world.entities) byId.set(entity.id, entity);

if (mutant) applyMutant(newWorktree, mutant);
const portBase = Number(env.PROOF_PORT_BASE ?? 30110);
const apps: AppServer[] = [];
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const stopLoad: (() => Promise<unknown>)[] = [];
// A stopped run takes its dev servers with it.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    for (const app of apps) stopApp(app);
    process.exit(143);
  });
}
const summary: Record<string, unknown> = { run: runName, seed, now: genNow, mutant: mutant?.name ?? null, load, config: { lanesCount, sizes, readCount, sequencesPerLane, stepsPerSequence, LIVE_BOUND_MS } };
try {
  apps.push(...(await Promise.all([
    startApp('old', oldWorktree, portBase, viteEnv, join(here, 'probe.ts'), out),
    startApp('new', newWorktree, portBase + 1, viteEnv, join(here, 'probe.ts'), out),
  ])));
  const [oldApp, newApp] = apps;
  browser = await launchBrowser();
  const b = browser;
  const pair = async (user: User, options: Parameters<typeof openLane>[3] = {}): Promise<[Lane, Lane]> => {
    const lanes = await Promise.all([openLane(b, oldApp, user, options), openLane(b, newApp, user, options)]);
    return [lanes[0], lanes[1]];
  };
  const userFor = (key: string) => {
    const user = users.get(key);
    if (!user) throw new Error(`no user ${key}`);
    return user;
  };

  // The first load of each dev server compiles the app; do it once, alone.
  {
    const warm = await pair(userFor(world.viewers[0].key));
    await Promise.all(warm.map((lane) => lane.page.getByRole("grid", { name: "Home" }).waitFor({ timeout: 180_000 }).catch(() => undefined)));
    await Promise.all(warm.map((lane) => lane.context.close()));
  }

  if (load) stopLoad.push(...startLoad(world, pair, userFor));

  if (phases.has('reads')) summary.reads = await readsPhase(pair, userFor);
  if (phases.has('dom')) summary.dom = await domPhase(pair, userFor);
  if (phases.has('sequences')) summary.sequences = await sequencesPhase(pair, userFor);
} finally {
  for (const stop of stopLoad) await stop().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  for (const app of apps) stopApp(app);
  if (mutant) revertMutant(newWorktree, mutant);
}
summary.retries = retries;
summary.ms = Date.now() - started;
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
log(`done in ${Math.round((Date.now() - started) / 1000)}s; unexplained ${JSON.stringify(unexplainedCounts())}`);

// ---------------------------------------------------------------------------

type Pair = (user: User, options?: Parameters<typeof openLane>[3]) => Promise<[Lane, Lane]>;

function unexplainedCounts() {
  return Object.fromEntries(unexplained);
}

/** Tallies classes; a class no closure explains counts as unexplained. */
function tallyInto(into: Map<string, { n: number; closure: string | null; example: unknown }>, diffs: Classified[], phase: string) {
  for (const diff of diffs) {
    const closure = closureOf(diff.cls);
    const entry = into.get(diff.cls);
    if (entry) entry.n += 1;
    else into.set(diff.cls, { n: 1, closure: closure?.id ?? null, example: diff });
    if (!closure) unexplained.set(phase, (unexplained.get(phase) ?? 0) + 1);
  }
}

function coverageAdd(into: Record<string, Record<string, number>>, dims: Record<string, string>) {
  for (const [dim, value] of Object.entries(dims)) {
    into[dim] ??= {};
    into[dim][value] = (into[dim][value] ?? 0) + 1;
  }
}

/** What the results themselves covered: permissions, kinds, odd values. */
function observed(snapshot: ProbeResult): Record<string, string>[] {
  const dims: Record<string, string>[] = [];
  const rows = project(snapshot);
  for (const entity of snapshot.entities) {
    const e = entity as Record<string, unknown>;
    const known = byId.get(String(e.id));
    dims.push({
      'result:kind': String(e.type),
      'result:access': known?.access ?? 'not-in-world',
      'result:name': typeof e.name !== 'string' ? 'none' : e.name.length > 200 ? 'long' : /[^\x20-\x7e]/.test(e.name) ? 'unicode' : e.name.startsWith(' ') ? 'leading-space' : 'plain',
      'result:notifiedAt': e.notified_at == null && e.notifiedAt == null ? 'null' : 'set',
    });
  }
  for (let i = 1; i < rows.length; i++) if (rows[i].notifiedAt !== null && rows[i].notifiedAt === rows[i - 1].notifiedAt) dims.push({ 'result:tie': 'adjacent-equal-notifiedAt' });
  dims.push({ 'result:size': rows.length === 0 ? '0' : rows.length === 1 ? '1' : rows.length < 100 ? '2-99' : rows.length <= 101 ? '100-101' : rows.length < 1000 ? '102-999' : '1000+' });
  return dims;
}

async function readsPhase(pair: Pair, userFor: (key: string) => User) {
  const rng = new Rng(seed * 101 + 3);
  const cases = generateReads(world, rng, readCount, 0, genNow);
  const byViewer = new Map<string, ReadCase[]>();
  for (const c of cases) byViewer.set(c.viewer, [...(byViewer.get(c.viewer) ?? []), c]);
  // Split big groups so workers stay busy.
  const groups: ReadCase[][] = [];
  for (const group of byViewer.values()) for (let i = 0; i < group.length; i += 60) groups.push(group.slice(i, i + 60));
  const classes = new Map<string, { n: number; closure: string | null; example: unknown }>();
  const coverage: Record<string, Record<string, number>> = {};
  const refByClass: Record<string, { 'ref-agrees': number; 'ref-disagrees': number; 'ref-absent': number; example: unknown }> = {};
  const refTransports: Record<string, number> = {};
  let done = 0;
  let failed = 0;
  const work = async () => {
    for (let group = groups.shift(); group; group = groups.shift()) {
      const user = userFor(group[0].viewer);
      const [oldLane, newLane] = await pair(user);
      try {
        for (const c of group) {
          // The third read is main's own GraphQL reader (update-time sort, which
          // main serves over GraphQL): the reference for field mappings.
          const refSpec: ReadSpec = { ...c.spec, params: { ...c.spec.params, sort_method: 'updated_at' } };
          const results = await readUntilAnswered(`read ${c.id}`, [oldLane, newLane], () => Promise.allSettled([probeRead(oldLane, user.macroUserId, c.spec), probeRead(newLane, user.macroUserId, c.spec), probeRead(oldLane, user.macroUserId, refSpec)]));
          if (results[0].status === 'rejected' || results[1].status === 'rejected') {
            failed += 1;
            const reason = results.slice(0, 2).map((r) => (r.status === 'rejected' ? String(r.reason).slice(0, 300) : 'ok'));
            record('reads.jsonl', { id: c.id, dims: c.dims, probeError: reason });
            tallyInto(classes, [classify({ signature: `probe-error:${results[0].status}/${results[1].status}`, kind: 'error', detail: reason.join(' | ') })], 'reads');
            continue;
          }
          const [a, b] = [results[0].value, results[1].value];
          const diffs = compareSnapshots(a, b, { pageSize: Number(c.spec.params?.limit) }).map(classify);
          tallyInto(classes, diffs, 'reads');
          const ref = results[2].status === 'fulfilled' ? results[2].value : null;
          refTransports[ref?.transport ?? 'failed'] = (refTransports[ref?.transport ?? 'failed'] ?? 0) + 1;
          const fieldDiffs = diffs.filter((d) => d.kind === 'field' && !d.cls.startsWith('same-instant:'));
          if (ref && ref.transport === 'graphql' && fieldDiffs.length) {
            const verdicts = refCheck(b, ref, fieldDiffs, sameInstant);
            fieldDiffs.forEach((d, i) => {
              const entry = (refByClass[d.cls] ??= { 'ref-agrees': 0, 'ref-disagrees': 0, 'ref-absent': 0, example: null });
              entry[verdicts[i]] += 1;
              if (verdicts[i] === 'ref-disagrees' && !entry.example) entry.example = { ...d, ref: ref.entities.find((e) => entityKey(e) === d.entity) };
            });
          }
          const dims = { ...c.dims, transport: `${a.transport}->${b.transport}`, pages: a.pages > 1 || b.pages > 1 ? 'multi' : 'single', paging: a.hasNextPage ? 'stopped-at-max' : 'complete' };
          coverageAdd(coverage, dims);
          for (const d of observed(b)) coverageAdd(coverage, d);
          record('reads.jsonl', {
            id: c.id,
            dims,
            old: { n: a.entities.length, pages: a.pages, ms: a.ms, error: a.error },
            new: { n: b.entities.length, pages: b.pages, ms: b.ms, error: b.error },
            classes: [...new Set(diffs.map((d) => d.cls))],
            open: diffs.filter((d) => !closureOf(d.cls)).slice(0, 5),
          });
          done += 1;
          if (done % 200 === 0) log(`reads: ${done}/${cases.length}`);
        }
      } finally {
        await Promise.all([oldLane.context.close(), newLane.context.close()]);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  log(`reads: ${done} compared, ${failed} probe errors`);
  // A transport-mapping closure holds only where main's GraphQL reader agrees.
  for (const [cls, entry] of Object.entries(refByClass)) {
    if (entry['ref-disagrees'] > 0 && closureOf(cls)?.needsRefAgreement) unexplained.set('reads-ref', (unexplained.get('reads-ref') ?? 0) + entry['ref-disagrees']);
  }
  return { cases: cases.length, compared: done, probeErrors: failed, classes: Object.fromEntries(classes), coverage, reference: { transports: refTransports, byClass: refByClass } };
}


/** Home never showed its list: which side, where it was, and a screenshot. */
class DomTimeout extends Error {
  side: string;
  detail: string;
  constructor(side: string, detail: string) {
    super(`Home did not show on ${side}: ${detail}`);
    this.side = side;
    this.detail = detail;
  }
}

let domTimeouts = 0;

async function settledDom(lane: Lane): Promise<DomRow[]> {
  try {
    await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 });
  } catch (error) {
    domTimeouts += 1;
    const shot = join(out, `dom-timeout-${domTimeouts}-${lane.side}.png`);
    await lane.page.screenshot({ path: shot }).catch(() => undefined);
    const text = await lane.page.evaluate(() => document.body?.innerText.slice(0, 300) ?? '').catch(() => '<no page>');
    const detail = `${lane.page.url()} | ${text.replace(/\s+/g, ' ')} | ${shot} | ${String(error).slice(0, 120)}`;
    log(`dom timeout: ${lane.side} ${detail}`);
    throw new DomTimeout(lane.side, detail);
  }
  let previous = '';
  let rows: DomRow[] = [];
  for (let i = 0; i < 6; i++) {
    await lane.page.waitForTimeout(1500);
    rows = await readHomeDom(lane);
    const text = JSON.stringify(rows);
    if (text === previous) return rows;
    previous = text;
  }
  return rows;
}

async function domPhase(pair: Pair, userFor: (key: string) => User) {
  const rng = new Rng(seed * 211 + 7);
  const jobs: { viewer: string; tab: 'signal' | 'noise'; touch: boolean; facets: Record<string, string[]> }[] = [];
  for (const viewer of world.viewers) {
    for (let k = 0; k < domPerViewer; k++) {
      const touch = k % 2 === 0;
      // Desktop Signal is the work feed, which this change does not touch.
      const tab = touch ? (rng.bool() ? 'signal' : 'noise') : 'noise';
      const facets: Record<string, string[]> = {};
      if (rng.bool(0.4)) facets.read = [rng.pick(['read', 'unread'])];
      if (rng.bool(0.4)) {
        const types = rng.subset(HOME_TYPES, 0.3);
        if (types.length) facets.type = types;
      }
      jobs.push({ viewer: viewer.key, tab, touch, facets });
    }
  }
  const classes = new Map<string, { n: number; closure: string | null; example: unknown }>();
  const coverage: Record<string, Record<string, number>> = {};
  let compared = 0;
  const work = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const user = userFor(job.viewer);
      const attempt = (job as { attempt?: number }).attempt ?? 0;
      const [oldLane, newLane] = await pair(user, { touch: job.touch, facets: job.facets, path: `/app/home?s0.home.tab=${job.tab}` });
      try {
        const settled = await Promise.allSettled([settledDom(oldLane), settledDom(newLane)]);
        const timedOut = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
        if (timedOut.length) {
          if (timedOut.some((e) => !(e instanceof DomTimeout))) throw timedOut[0];
          // Once more on fresh tabs; a second miss is a difference of its own.
          if (attempt === 0) jobs.push({ ...job, attempt: 1 } as typeof job);
          else tallyInto(classes, timedOut.map((e: DomTimeout) => classify({ signature: `dom:timeout:${e.side}`, kind: 'dom', detail: e.detail })), 'dom');
          continue;
        }
        const [a, b] = settled.map((r) => (r as PromiseFulfilledResult<DomRow[]>).value);
        const diffs = (await compareHomeDom(stack, user, a, b, `home ${job.touch ? 'touch' : 'desktop'} ${job.tab}`)).map(classify);
        tallyInto(classes, diffs, 'dom');
        const dims = {
          viewer: world.viewers.find((v) => v.key === job.viewer)?.role === 'size' ? `size:${job.viewer}` : 'lane',
          layout: job.touch ? 'touch' : 'desktop',
          tab: job.tab,
          facetRead: job.facets.read?.[0] ?? 'all',
          facetTypes: String(job.facets.type?.length ?? 0),
          rows: a.length === 0 ? '0' : a.length < 20 ? '1-19' : a.length < 100 ? '20-99' : '100+',
        };
        coverageAdd(coverage, dims);
        record('dom.jsonl', { job, dims, old: a.length, new: b.length, classes: diffs.map((d) => d.cls), diffs: diffs.slice(0, 4) });
        if (compared === 0) {
          await oldLane.page.screenshot({ path: join(out, 'dom-first-old.png') });
          await newLane.page.screenshot({ path: join(out, 'dom-first-new.png') });
        }
        compared += 1;
      } finally {
        await Promise.all([oldLane.context.close(), newLane.context.close()]);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, 4) }, work));
  log(`dom: ${compared} compared`);
  return { compared, classes: Object.fromEntries(classes), coverage };
}

// Each lane viewer has four page pairs: lists kept mounted (live), fresh reads
// on a page that mounts nothing else (raw), a page reloaded after every step
// (reload), and Home on a touch screen (dom).
type LaneSet = { live: [Lane, Lane]; raw: [Lane, Lane]; reload: [Lane, Lane]; dom: [Lane, Lane] };

async function sequencesPhase(pair: Pair, userFor: (key: string) => User) {
  const classes = new Map<string, { n: number; closure: string | null; example: unknown }>();
  const steps: Record<string, Record<string, number>> = {};
  const liveTimes: Record<string, number[]> = {};
  let sequences = 0;
  let stepCount = 0;
  const resetCount = [0, 0];
  const reopenCount = [0, 0];
  // PROOF_SEQ_LANES runs sequences for only the first lanes (a trial).
  const laneViewers = world.viewers.filter((v) => v.role === 'lane').slice(0, Number(env.PROOF_SEQ_LANES ?? Infinity));

  const runLane = async (viewerKey: string, laneIndex: number) => {
    const user = userFor(viewerKey);
    const lanes: LaneSet = {
      live: await pair(user),
      raw: await pair(user),
      reload: await pair(user),
      dom: await pair(user, { touch: true }),
    };
    const ctx: ActionContext = { stack, queueUrl: env.PROOF_QUEUE_URL ?? '', world, users, viewer: viewerKey, rng: new Rng(seed * 1000 + laneIndex), created: [] };
    const specRng = new Rng(seed * 2000 + laneIndex);
    try {
      for (let s = 0; s < sequencesPerLane; s++) {
        const random = generateReads(world, specRng, 40, 0, genNow).find((c) => c.viewer === viewerKey) ?? generateReads(world, specRng, 1, 0, genNow)[0];
        const specs: ReadSpec[] = [
          { source: { kind: 'home', tab: 'signal', facets: {}, foreignEntities: true }, maxPages: 1 },
          { source: { kind: 'home', tab: 'noise', facets: {}, foreignEntities: true }, maxPages: 1 },
          { ...random.spec, fresh: false, maxPages: Math.min(random.spec.maxPages ?? 1, 3) },
        ];
        const ids = specs.map((_, i) => `s${s}-${i}`);
        record("sequences.jsonl", { lane: viewerKey, sequence: s, specs });
        await Promise.all(
          lanes.live.map((lane) => Promise.all(specs.map((spec, i) => probeOpenLive(lane, ids[i], user.macroUserId, spec))))
        );
        // The on-screen list for contract checks: touch Home, Signal or Noise.
        const domTab = s % 2 === 0 ? 'signal' : 'noise';
        await Promise.all(lanes.dom.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${domTab}`)));

        // Per spec and side: each discrepancy of the mounted list, and the step
        // (kind/entity kind) that first produced it.
        const origins = specs.map(() => [new Map<string, string>(), new Map<string, string>()]);
        for (let k = 0; k < stepsPerSequence; k++) {
          const kind = ctx.rng.weighted(STEP_WEIGHTS) as StepKind;
          const step = await runStep(ctx, kind);
          stepCount += 1;
          steps[kind] ??= {};
          const outcome = step.ok ? 'ok' : `refused:${step.status ?? 'error'}`;
          steps[kind][outcome] = (steps[kind][outcome] ?? 0) + 1;
          // A write the harness could not make (its session lapsed) tests
          // nothing; it fails the run instead of passing as a quiet step.
          if (!step.ok && step.status === 401) {
            tallyInto(classes, [classify({ signature: 'harness:step-unauthorized', kind: 'error', detail: step.note ?? '' })], 'sequences');
          }
          const at = { lane: viewerKey, sequence: s, step: k, kind, entity: step.entity, entityKind: step.entityKind };
          const checks: Record<string, unknown> = {};

          const phaseStart = Date.now();
          const ms: Record<string, number> = {};
          // 1. Read-after-write: a fresh network read of every spec, both sides.
          const raw: [Row[], Row[]][] = [];
          for (let i = 0; i < specs.length; i++) {
            let tries = 0;
            let pairRead: [ProbeResult, ProbeResult] | undefined;
            for (;;) {
              tries += 1;
              const read = await Promise.allSettled([probeRead(lanes.raw[0], user.macroUserId, { ...specs[i], fresh: true, clean: true }), probeRead(lanes.raw[1], user.macroUserId, { ...specs[i], fresh: true, clean: true })]);
              if (read[0].status === 'fulfilled' && read[1].status === 'fulfilled') pairRead = [read[0].value, read[1].value];
              // A replica can answer one side before it has the write: read
              // again, both sides, a few times before calling it a difference.
              if ((pairRead && sameRows(project(pairRead[0]), project(pairRead[1]))) || tries >= 4) break;
              await new Promise((r) => setTimeout(r, 1500));
            }
            if (!pairRead) {
              tallyInto(classes, [classify({ signature: `raw:probe-error`, kind: 'error', detail: JSON.stringify(at) })], 'sequences');
              raw.push([[], []]);
              continue;
            }
            const diffs = compareSnapshots(pairRead[0], pairRead[1], { label: `raw spec${i}` }).map(classify);
            tallyInto(classes, diffs, 'sequences');
            raw.push([project(pairRead[0]), project(pairRead[1])]);
            const errors = diffs.filter((d) => d.kind === 'error').map((d) => d.detail.slice(0, 200));
            checks[`raw${i}`] = { tries, classes: [...new Set(diffs.map((d) => d.cls))], rows: [pairRead[0].entities.length, pairRead[1].entities.length], ...(errors.length ? { errors } : {}) };
          }

          ms.raw = Date.now() - phaseStart;
          // 2. Live: each side's mounted list must reach its own fresh read
          // within the bound; then the two live lists are compared.
          const liveStart = Date.now();
          const reached: (number | null)[][] = specs.map(() => [null, null]);
          const lastLive: (Row[] | null)[][] = specs.map(() => [null, null]);
          // Each side's last snapshot state, for the evidence of a miss.
          const lastMeta: (string | null)[][] = specs.map(() => [null, null]);
          while (Date.now() - liveStart < LIVE_BOUND_MS) {
            for (let i = 0; i < specs.length; i++) {
              for (const side of [0, 1]) {
                if (reached[i][side] !== null) continue;
                const snap = await probeSnapLive(lanes.live[side], ids[i]);
                if (!snap) continue;
                lastLive[i][side] = project(snap);
                lastMeta[i][side] = `${snap.transport}${snap.error ? ` error ${snap.error.slice(0, 160)}` : ''} settled=${snap.settled} entities=${snap.entities.length}`;
                if (snap.settled && sameRows(lastLive[i][side] ?? [], raw[i][side])) reached[i][side] = Date.now() - liveStart;
              }
            }
            if (reached.every((r) => r[0] !== null && r[1] !== null)) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          // A lane whose requests the browser failed for a network change in the
          // window may miss the bound for that reason alone: say so in the class.
          const changed = lanes.live.map((lane) => (networkChangedSince(lane, liveStart) ? ':after-network-change' : ''));
          const missNotes: string[] = [];
          for (let i = 0; i < specs.length; i++) {
            const tag = specs[i].groupBy ? 'grouped' : i < 2 ? 'home' : 'random';
            for (const side of [0, 1]) {
              const key = `${side ? 'new' : 'old'}:${tag}:${kind}`;
              liveTimes[key] ??= [];
              liveTimes[key].push(reached[i][side] ?? -1);
            }
            // Each side's mounted list against its own fresh read, as tokens
            // (lib/project.ts discrepancies), each remembered with the step
            // that first produced it: a list left behind by one write stays
            // behind through later steps, and is attributed to that write.
            // The fresh reads agree when they hold the same rows, or differ only
            // in classes closed for the transports (calendar stamps, D2).
            const rawClasses = (checks[`raw${i}`] as { classes?: string[] } | undefined)?.classes ?? [];
            const freshAgree = sameRows(raw[i][0], raw[i][1]) || (rawClasses.length > 0 && rawClasses.every((c) => closureOf(c)));
            const tokens = [0, 1].map((side) => (reached[i][side] !== null ? [] : lastLive[i][side] ? discrepancies(lastLive[i][side]!, raw[i][side]) : ['unread']));
            for (const side of [0, 1]) {
              const seen = origins[i][side];
              for (const token of [...seen.keys()]) if (!tokens[side].includes(token)) seen.delete(token);
              for (const token of tokens[side]) if (!seen.has(token)) seen.set(token, `${kind}/${step.entityKind ?? '-'}`);
            }
            const tOld = tokens[0];
            // A grouped list's pages carry no notification times, yet a row
            // mapped while the websocket floor held (5 min) keeps that stamp
            // until it is mapped again. Main's REST grouped list maps again
            // whenever a notification refetches it; the branch's GraphQL one
            // does not. Only a stamp that is one of this viewer's notification
            // times for the entity, where the fresh read has none, is this.
            const held = specs[i].groupBy && reached[i][1] === null ? await heldNotifiedStamps(user, lastLive[i][1] ?? [], raw[i][1], tokens[1].filter((t) => !tOld.includes(t))) : [];
            const tNew = tokens[1].filter((t) => !held.includes(t));
            const origin = (side: number, token: string) => origins[i][side].get(token) ?? `${kind}/${step.entityKind ?? '-'}`;
            const note = (side: number, list: string[]) => list.map((t) => `${t}<${origin(side, t)}`).join(' ').slice(0, 600);
            const emit = (signature: string, detail: string) => tallyInto(classes, [classify({ signature, kind: 'order', detail: `${JSON.stringify(at)} ${detail}` })], 'sequences');
            for (const side of [0, 1]) if (tokens[side].length) missNotes.push(`spec${i} ${side ? "new" : "old"} ${note(side, tokens[side])}`);
            const unsettled = [0, 1].filter((side) => reached[i][side] === null && tokens[side].length === 0);
            for (const side of unsettled) emit(`live:${tag}:${side ? 'new' : 'old'}-unsettled${changed[side]}`, 'the list matched its read but never settled');
            // The branch missed something main did not: never closed.
            if (held.length) emit(`live:${tag}:new-held-notified-stamp`, note(1, held));
            const newOnly = tNew.filter((t) => !tOld.includes(t) || t === 'unread');
            if (newOnly.length) {
              emit(`live:${tag}:new-not-within-bound${changed[1]}`, note(1, newOnly));
              // The evidence for an open difference: each side's mounted rows
              // and its fresh read, as key@notifiedAt in list order.
              const compact = (rows: Row[] | null) => (rows ?? []).map((r) => `${r.key}@${r.notifiedAt ?? '-'}`);
              const evidence = (checks.liveRows as unknown[] | undefined) ?? [];
              evidence.push({ spec: i, oldMeta: lastMeta[i][0], newMeta: lastMeta[i][1], oldLive: compact(lastLive[i][0]), oldFresh: compact(raw[i][0]), newLive: compact(lastLive[i][1]), newFresh: compact(raw[i][1]) });
              checks.liveRows = evidence;
            }
            else if (tOld.length || tNew.length) {
              if (!freshAgree) emit(`live:${tag}:fresh-reads-differ`, `${note(0, tOld)} | ${note(1, tNew)}`);
              else {
                // Shared tokens: both lists are behind in the same way, row for
                // row. Old-only tokens: main is behind where the branch shows
                // exactly what main shows after a reload.
                const rowOf = (side: number, key: string) => JSON.stringify(lastLive[i][side]?.find((r) => r.key === key) ?? null);
                const alike = tNew.every((t) => t === 'order' || rowOf(0, t.slice(t.indexOf(':') + 1)) === rowOf(1, t.slice(t.indexOf(':') + 1)));
                for (const label of new Set(tNew.map((t) => origin(0, t)))) {
                  emit(alike ? `live:${tag}:both-stale-alike:${label}` : `live:${tag}:both-not-within-bound${changed[0] || changed[1]}`, note(0, tNew.filter((t) => origin(0, t) === label)));
                }
                if (tOld.includes('unread')) emit(`live:${tag}:old-unread${changed[0]}`, 'no snapshot of the mounted list');
                const oldOnly = tOld.filter((t) => !tNew.includes(t) && t !== 'unread');
                for (const label of new Set(oldOnly.map((t) => origin(0, t)))) {
                  emit(`live:${tag}:old-behind:${label}${changed[0]}`, note(0, oldOnly.filter((t) => origin(0, t) === label)));
                }
              }
            }
          }
          checks.live = reached;
          ms.live = Date.now() - liveStart;
          // A list that missed the bound is read again from a new mount, so
          // one miss is counted at the step that made it and later steps start
          // from a list that follows them. Its state at the miss (query flags,
          // pages, the storage resets the probe saw) goes with the evidence.
          const wedged: unknown[] = [];
          for (let i = 0; i < specs.length; i++) {
            for (const side of [0, 1]) {
              if (reached[i][side] !== null) continue;
              const state = await probeLiveDebug(lanes.live[side], ids[i]).catch((e) => String(e));
              const reopened = await probeOpenLive(lanes.live[side], ids[i], user.macroUserId, specs[i]).then((r) => ({ entities: r.entities.length, matchesFresh: sameRows(project(r), raw[i][side]) }), (e) => String(e).slice(0, 200));
              wedged.push({ spec: i, side: side ? 'new' : 'old', state, reopened });
              reopenCount[side] += 1;
            }
          }
          if (wedged.length) checks.reopened = wedged;
          // Where each missed live list parts from its fresh read, for the record.
          if (missNotes.length) checks.liveMisses = missNotes;

          // 3. Reload: a new document on each side reads every spec.
          await Promise.all(lanes.reload.map((lane) => reloadLane(lane, undefined, { probe: true })));
          for (let i = 0; i < specs.length; i++) {
            const read = await readUntilAnswered(`reload ${JSON.stringify(at)} spec${i}`, lanes.reload, () => Promise.allSettled([probeRead(lanes.reload[0], user.macroUserId, specs[i]), probeRead(lanes.reload[1], user.macroUserId, specs[i])]));
            if (read[0].status !== 'fulfilled' || read[1].status !== 'fulfilled') {
              tallyInto(classes, [classify({ signature: 'reload:probe-error', kind: 'error', detail: JSON.stringify(at) })], 'sequences');
              continue;
            }
            const diffs = compareSnapshots(read[0].value, read[1].value, { label: `reload spec${i}` }).map(classify);
            tallyInto(classes, diffs, 'sequences');
            checks[`reload${i}`] = [...new Set(diffs.map((d) => d.cls))];
            const errors = diffs.filter((d) => d.kind === 'error').map((d) => d.detail.slice(0, 200));
            if (errors.length) checks[`reload${i}errors`] = errors;
          }

          ms.reload = Date.now() - phaseStart - ms.raw - ms.live;
          // 4. Every few steps, Home on screen (touch): the rows the viewer sees.
          if ((k + 1) % DOM_EVERY === 0) {
            const deadline = Date.now() + LIVE_BOUND_MS;
            let diffs: Classified[] = [];
            let rows: [DomRow[], DomRow[]] = [[], []];
            do {
              const settled = await Promise.allSettled(lanes.dom.map((lane) => settledDom(lane)));
              const timedOut = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
              if (timedOut.length) {
                if (timedOut.some((e) => !(e instanceof DomTimeout))) throw timedOut[0];
                diffs = timedOut.map((e: DomTimeout) => classify({ signature: `seq home touch ${domTab} dom:timeout:${e.side}`, kind: 'dom', detail: e.detail }));
                break;
              }
              rows = settled.map((r) => (r as PromiseFulfilledResult<DomRow[]>).value) as [DomRow[], DomRow[]];
              diffs = (await compareHomeDom(stack, user, rows[0], rows[1], `seq home touch ${domTab}`)).map(classify);
              if (diffs.every((d) => closureOf(d.cls))) break;
            } while (Date.now() < deadline);
            // Still apart: reload both and read again. When the reloaded sides
            // agree and the branch's mounted Home already showed its reload,
            // main's mounted Home was behind its own reload, and the
            // differences become one class for that. Anything else stays.
            const open = diffs.filter((d) => !closureOf(d.cls));
            if (open.length && !open.some((d) => d.cls.includes('dom:timeout'))) {
              await Promise.all(lanes.dom.map((lane) => reloadLane(lane)));
              const again = await Promise.allSettled(lanes.dom.map((lane) => settledDom(lane)));
              if (again.every((r) => r.status === 'fulfilled')) {
                const reloaded = again.map((r) => (r as PromiseFulfilledResult<DomRow[]>).value);
                const sides = (await compareHomeDom(stack, user, reloaded[0], reloaded[1], `seq home touch ${domTab} reload`)).map(classify);
                const newHeld = (await compareHomeDom(stack, user, reloaded[1], rows[1], 'held')).length === 0;
                const oldHeld = (await compareHomeDom(stack, user, reloaded[0], rows[0], 'held')).length === 0;
                checks.domReload = { sides: sides.map((d) => d.cls), newHeld, oldHeld };
                // The evidence for an open difference: each side's mounted and
                // reloaded rows, as bucket/type:id "text" in screen order.
                const compactDom = (list: DomRow[]) => list.map((r) => (r.kind === 'entity' ? `${r.id.split('|').slice(2).map((p) => p.replace(/^s\d+:/, '')).join('/')}${r.unread ? '*' : ''} ${r.text}` : `# ${r.label}`));
                checks.domRows = { oldMounted: compactDom(rows[0]), newMounted: compactDom(rows[1]), oldReload: compactDom(reloaded[0]), newReload: compactDom(reloaded[1]) };
                if (sides.every((d) => closureOf(d.cls)) && newHeld) {
                  diffs = [...diffs.filter((d) => closureOf(d.cls)), classify({ signature: `seq home touch ${domTab} dom:old-behind-reload`, kind: 'dom', detail: open.map((d) => `${d.cls}: ${d.detail}`).join(' | ').slice(0, 600) })];
                }
              }
            }
            tallyInto(classes, diffs, 'sequences');
            checks.dom = { rows: [rows[0].length, rows[1].length], classes: diffs.map((d) => d.cls) };
          }
          ms.total = Date.now() - phaseStart;
          checks.ms = ms;
          record('steps.jsonl', { ...at, time: new Date().toISOString(), ok: step.ok, status: step.status, note: step.note, checks });
        }
        await Promise.all(lanes.live.map((lane) => lane.page.evaluate(() => (window as never as { __proofProbe: { closeAllLive: () => void } }).__proofProbe.closeAllLive())));
        sequences += 1;
        log(`sequences: lane ${viewerKey} finished sequence ${s + 1}/${sequencesPerLane}`);
      }
    } finally {
      // Storage resets the probe saw (it reopened its readers each time).
      for (const [side, lane] of lanes.live.entries()) {
        const reopens = await lane.page.evaluate(() => (window as never as { __proofProbe: { resetReopens: () => unknown[] } }).__proofProbe.resetReopens()).catch(() => []);
        for (const r of reopens) record('resets.jsonl', { lane: viewerKey, side: side === 0 ? 'old' : 'new', ...(r as object) });
        resetCount[side] += reopens.length;
      }
      for (const lanePair of Object.values(lanes)) await Promise.all(lanePair.map((lane: Lane) => lane.context.close().catch(() => undefined)));
    }
  };
  // At most PROOF_SEQ_CONCURRENCY lanes run sequences at once (default: all):
  // one browser serves every lane, and a starved browser misses live bounds
  // for its own reasons.
  const concurrency = Number(env.PROOF_SEQ_CONCURRENCY ?? laneViewers.length);
  let nextLane = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, laneViewers.length) }, async () => {
      while (nextLane < laneViewers.length) {
        const i = nextLane++;
        await runLane(laneViewers[i].key, i);
      }
    })
  );
  const liveStats = Object.fromEntries(
    Object.entries(liveTimes).map(([key, times]) => {
      const ok = times.filter((t) => t >= 0).sort((x, y) => x - y);
      return [key, { n: times.length, within: ok.length, p50: ok[Math.floor(ok.length / 2)] ?? null, p95: ok[Math.floor(ok.length * 0.95)] ?? null, max: ok[ok.length - 1] ?? null }];
    })
  );
  return { sequences, steps: stepCount, stepOutcomes: steps, classes: Object.fromEntries(classes), live: liveStats, storageResets: { old: resetCount[0], new: resetCount[1] }, liveReopens: { old: reopenCount[0], new: reopenCount[1] } };
}

/** Concurrent load for the whole run: notifications to other viewers through
 * the ingress queue, and the largest viewer's lists read on both sides. */
function startLoad(world: World, pair: Pair, userFor: (key: string) => User): (() => Promise<unknown>)[] {
  let running = true;
  const counts = { notifications: 0, reads: 0, errors: 0 };
  const rng = new Rng(seed * 7 + 1);
  const targets = world.entities.filter((e) => world.viewers.find((v) => v.key === e.viewer)?.role === 'size');
  const notifier = async () => {
    while (running && targets.length) {
      const entity = rng.pick(targets);
      const recipient = world.viewers.find((v) => v.key === entity.viewer)?.userId ?? '';
      await queueNotify(stack, env.PROOF_QUEUE_URL ?? '', entity, [recipient], sender(world, entity), rng, { waitMs: 5000 })
        .then(() => (counts.notifications += 1), () => (counts.errors += 1));
    }
  };
  const big = world.viewers.filter((v) => v.role === 'size').sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
  const reader = async () => {
    if (!big) return;
    const user = userFor(big.key);
    const [a, b] = await pair(user);
    try {
      while (running) {
        const spec: ReadSpec = { source: { kind: 'home', tab: rng.pick(['signal', 'noise'] as const), facets: {}, foreignEntities: true }, fresh: true, maxPages: 20 };
        await Promise.all([probeRead(a, user.macroUserId, spec), probeRead(b, user.macroUserId, spec)]).then(() => (counts.reads += 2), () => (counts.errors += 1));
      }
    } finally {
      await Promise.all([a.context.close(), b.context.close()]).catch(() => undefined);
    }
  };
  const tasks = [...Array.from({ length: 6 }, notifier), reader(), reader()];
  log('load: started 6 notifiers and 2 reader pairs');
  return [
    async () => {
      running = false;
      await Promise.allSettled(tasks);
      summary.loadCounts = counts;
      log(`load: ${JSON.stringify(counts)}`);
    },
  ];
}

/**
 * Runs `attempt` (reads on both sides) and, while one of its reads got no
 * answer, runs it again, at most twice. A read that got no answer says
 * nothing about either reader: it is not compared, and every retry is
 * recorded (retries.jsonl, summary.retries) with the requests the browser
 * gave up on and their network error, so a reader that hangs or fails on one
 * side only still shows, as an open difference once the retries run out.
 */
async function readUntilAnswered(where: string, lanes: Lane[], attempt: () => Promise<PromiseSettledResult<ProbeResult>[]>) {
  for (let tries = 1; ; tries++) {
    const marks = lanes.map((lane) => lane.failed.length);
    const results = await attempt();
    const unanswered = results.flatMap((r, i) => {
      const message = r.status === 'rejected' ? String(r.reason) : r.value.error ? String(r.value.error) : '';
      // Main's own 12 s deadline (closure T9) is no answer either: the read
      // is tallied as error:old:deadline only if every retry hits it too.
      const deadline = i === 0 && OLD_DEADLINE.test(message);
      return NO_ANSWER.test(message) || deadline ? [{ read: i, deadline, message: message.slice(0, 160) }] : [];
    });
    if (!unanswered.length || tries > 2) return results;
    const requests: RequestFailure[] = lanes.flatMap((lane, i) => lane.failed.slice(marks[i]));
    const key = unanswered.some((u) => u.deadline)
      ? 'old:deadline'
      : requests.length
        ? [...new Set(requests.map((r) => `${r.side}:${r.error}`))].sort().join('+')
        : `no-failed-request:${unanswered.map((u) => (u.read === 1 ? 'new' : 'old')).join('+')}`;
    retries[key] = (retries[key] ?? 0) + 1;
    record('retries.jsonl', { at: new Date().toISOString(), where, tries, unanswered, requests: requests.slice(0, 12) });
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Whether the browser failed one of the lane's requests for a network change since `since` (ms). */
function networkChangedSince(lane: Lane, since: number) {
  return lane.failed.some((f) => f.error === 'net::ERR_NETWORK_CHANGED' && Date.parse(f.at) >= since);
}

/** The `notifiedAt:<key>` tokens of a mounted grouped list whose stamp is one
 * of the viewer's notification times for that entity while its fresh read
 * shows none: a stamp held from the websocket floor (see the live check). */
async function heldNotifiedStamps(user: User, live: Row[], fresh: Row[], candidates: string[]): Promise<string[]> {
  const held: string[] = [];
  for (const token of candidates) {
    if (!token.startsWith('notifiedAt:')) continue;
    const key = token.slice('notifiedAt:'.length);
    const mounted = live.find((r) => r.key === key);
    const read = fresh.find((r) => r.key === key);
    if (!mounted?.notifiedAt || !read || read.notifiedAt !== null) continue;
    const id = key.slice(key.indexOf(':') + 1);
    const times = await sql<{ at: string }>(
      stack,
      `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM user_notification WHERE user_id = ${q(user.macroUserId)} AND event_item_id = ${q(id)}`
    );
    if (times.some((t) => instant(t.at) === mounted.notifiedAt)) held.push(token);
  }
  return held;
}
