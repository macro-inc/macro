/**
 * One differential run: builds its worlds, then runs the translator fuzz, the
 * caller suite and one-shots, the stateful sequences and (optionally) the
 * mutant campaigns, all comparing main's app (old origin) with the branch's
 * (new origin) on the same data. run.sh starts the apps and calls this.
 *
 *   bun run run.ts --seed s1 --label quiet --out results/quiet.json
 *     [--load] [--fuzz 1500] [--seq-lanes 8] [--seqs 104] [--steps 20]
 *     [--mutants] [--mutant-steps 20] [--cache on|off] [--new-ref sha] [--old-ref sha] [--old http://localhost:23251]
 *     [--new http://localhost:23250] [--stack https://localhost:23209]
 *     [--instance gqlsoup]
 */
import { parseArgs } from 'node:util';
import { type Browser, launch, closeBrowser, loadProbe, openUser, type UserSession } from './lib/browser';
import { MUTANTS, plantMutant, type Mutant } from './lib/mutants';
import { startLoad } from './lib/load';
import { pool } from './lib/pool';
import { Coverage, Rng } from './lib/rng';
import { emptyCallerResult, runCallerLane, runOneShots } from './lib/suite-callers';
import { emptyFuzzResult, runFuzzLane } from './lib/suite-fuzz';
import { emptySeqResult, openTruthPage, runSequenceLane, setAaControl, type SeqResult } from './lib/suite-seq';
import { buildWorld, linkPullRequests, setupRetries, type UserKey, USER_KEYS, type World } from './lib/world';

const { values: a } = parseArgs({
  options: {
    seed: { type: 'string' },
    label: { type: 'string' },
    out: { type: 'string' },
    load: { type: 'boolean', default: false },
    fuzz: { type: 'string', default: '1500' },
    callers: { type: 'boolean', default: true },
    'no-callers': { type: 'boolean', default: false },
    'seq-lanes': { type: 'string', default: '8' },
    /** Step-kind weights for a focused pass, e.g. 'rename=6,option=4'; unnamed kinds are left out. */
    weights: { type: 'string' },
    seqs: { type: 'string', default: '104' },
    steps: { type: 'string', default: '20' },
    'mutant-steps': { type: 'string', default: '20' },
    lanes: { type: 'string', default: '6' },
    /** The commits the two apps serve (run.sh checks the checkouts match them). */
    'new-ref': { type: 'string' },
    'old-ref': { type: 'string' },
    mutants: { type: 'boolean', default: false },
    cache: { type: 'string', default: 'on' },
    old: { type: 'string', default: 'http://localhost:23251' },
    new: { type: 'string', default: 'http://localhost:23250' },
    stack: { type: 'string', default: 'https://localhost:23209' },
    instance: { type: 'string', default: 'gqlsoup' },
    scale: { type: 'string', default: 'full' },
    /** A/A control: main's app and probe on both sides (run.sh's aa pass). */
    aa: { type: 'boolean', default: false },
  },
});
if (!a.seed || !a.label || !a.out) throw new Error('--seed, --label and --out are required');
const seed = a.seed;
const origins = { old: a.old as string, new: a.new as string };
const probePaths = { new: a.aa ? '/src/difftest-probe/old.tsx' : '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
if (a.aa) setAaControl();
const started = Date.now();
const log = (line: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(5)}s] ${a.label}: ${line}`);

async function git(dir: string, ...args: string[]) {
  const p = Bun.spawn(['git', '-C', dir, ...args], { stdout: 'pipe' });
  return (await new Response(p.stdout).text()).trim();
}

async function world(worldSeed: string, scale: 'full' | 'small', lean = false) {
  const w = await buildWorld({ instance: a.instance as string, origin: a.stack as string, seed: worldSeed, scale, log, lean });
  await linkPullRequests({ instance: w.instance, rng: new Rng(`links/${worldSeed}`), entities: w.entities, coverage: w.coverage });
  return w;
}

/** Opening an app page loads its whole module graph from Vite: two at a time. */
const openSlots = [Promise.resolve(), Promise.resolve()];
let slot = 0;
async function serialOpen<T>(fn: () => Promise<T>): Promise<T> {
  const k = slot++ % openSlots.length;
  const run = openSlots[k].then(fn, fn);
  openSlots[k] = run.then(
    () => {},
    () => {}
  );
  return await run;
}

async function session(b: Browser, w: World, user: UserKey): Promise<UserSession> {
  const u = w.users[user];
  return await reopen(`session ${w.tag} ${user}`, () => serialOpen(() => openUser(b, origins, u.email, probePaths, u.browserCookies())));
}

/** Pages a lane opened only on a retry: a dev-server page that stayed blank at sign-in, then opened. */
const openRetries: { what: string; error: string }[] = [];

/**
 * Opens a lane's pages, up to three times: now and then a dev-server page
 * stays blank at sign-in for minutes, and the lane would otherwise lose all
 * its sequences. Each try opens a new context.
 */
async function reopen<T>(what: string, open: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await open();
    } catch (error) {
      if (attempt >= 2) throw error;
      openRetries.push({ what, error: String(error).slice(0, 300) });
      log(`${what}: opening again after: ${String(error).slice(0, 160)}`);
    }
  }
}

/** Runs `fn`, recording a crash as the lane's error instead of ending the run. */
async function lane<T>(name: string, errors: { lane: string; error: string }[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    errors.push({ lane: name, error: String((error as Error)?.stack ?? error).slice(0, 2000) });
    log(`lane ${name} crashed: ${String(error).slice(0, 200)}`);
    return undefined;
  }
}

function mergeSeq(into: SeqResult, from: SeqResult) {
  into.sequences += from.sequences;
  into.steps += from.steps;
  into.reloads += from.reloads;
  into.comparisons += from.comparisons;
  into.conflictRetries += from.conflictRetries;
  into.failures.push(...from.failures);
  into.newOnly.push(...from.newOnly);
  into.repairs.push(...from.repairs);
  into.hangs.push(...from.hangs);
  into.aborted.push(...from.aborted);
  const add = (t: Record<string, number>, f: Record<string, number>) => {
    for (const [k, v] of Object.entries(f)) t[k] = (t[k] ?? 0) + v;
  };
  add(into.stepKinds, from.stepKinds);
  add(into.writeErrors, from.writeErrors);
  add(into.ruleHits, from.ruleHits);
  for (const m of ['live', 'raw'] as const)
    for (const [k, v] of Object.entries(from[m])) {
      const t = (into[m][k] ??= { both: 0, neither: 0, oldOnly: 0, newOnly: 0, unaffected: 0, latencyOld: [], latencyNew: [] });
      for (const f of ['both', 'neither', 'oldOnly', 'newOnly', 'unaffected'] as const) t[f] += v[f];
      t.latencyOld.push(...v.latencyOld);
      t.latencyNew.push(...v.latencyNew);
    }
  for (const f of ['equal', 'bothStale', 'branchFresher', 'branchStaler', 'skipped'] as const) into.liveData[f] += from.liveData[f];
  add(into.liveData.fresherBy, from.liveData.fresherBy);
  add(into.liveData.fresherFields, from.liveData.fresherFields);
  for (const [k, v] of Object.entries(from.incidental)) {
    const g = (into.incidental[k] ??= { count: 0, samples: [] });
    g.count += v.count;
    g.samples.push(...v.samples.slice(0, Math.max(0, 3 - g.samples.length)));
  }
}

/** Steps main shows live in its mounted readers: what a mutant campaign leans on. */
const MUTANT_WEIGHTS = { 'rename.app': 10, create: 3, 'move.app': 2, 'share.app': 2, 'markRead.app': 2, 'view.app': 2 };

const b = await launch();
const errors: { lane: string; error: string }[] = [];
const coverage = new Coverage();
const out: Record<string, unknown> = {
  meta: {
    label: a.label,
    seed,
    cache: a.cache,
    load: a.load,
    apps: { new: a['new-ref'], old: a['old-ref'] },
    harness: await git(import.meta.dir, 'rev-parse', 'HEAD'),
    harnessDirty: (await git(import.meta.dir, 'status', '--porcelain', '.')).length > 0,
    origins,
    startedAt: new Date(started).toISOString(),
  },
};
try {
  // ---------------------------------------------------------------- worlds
  const seqLanes = Number(a['seq-lanes']);
  const seqs = Number(a.seqs);
  const mutantKinds: (Mutant | 'control')[] = a.mutants ? ['control', ...MUTANTS] : [];
  log(`building worlds: one ${a.scale}, ${seqLanes} sequence, ${mutantKinds.length} mutant${a.load ? ', one load' : ''}`);
  const specs: [string, 'full' | 'small'][] = [
    [seed, a.scale as 'full' | 'small'],
    ...Array.from({ length: seqLanes }, (_, k) => [`${seed}-s${k}`, 'small'] as [string, 'small']),
    ...mutantKinds.map((m) => [`${seed}-m${m}`, 'small'] as [string, 'small']),
    ...(a.load ? [[`${seed}-load`, 'small'] as [string, 'small']] : []),
  ];
  const [main, ...small] = await pool(specs, 4, ([s, scale], i) => world(s, scale, i > 0));
  const seqWorlds = small.slice(0, seqLanes);
  const mutantWorlds = small.slice(seqLanes, seqLanes + mutantKinds.length);
  const loadWorld = a.load ? small[small.length - 1] : undefined;
  // Load acts as the load world's owner and member only (a lean world).
  coverage.merge(main.coverage);
  for (const w of small) coverage.merge(w.coverage);
  out.worlds = {
    main: { tag: main.tag, sizes: main.sizes, entities: main.entities.length },
    sequences: seqWorlds.map((w) => ({ tag: w.tag, entities: w.entities.length })),
  };
  log('worlds built');

  const load = loadWorld ? startLoad({ world: loadWorld, rng: new Rng(`load/${seed}`), concurrency: 16 }) : undefined;

  // ---------------------------------------------------------------- lanes
  const fuzzUsers: UserKey[] = [...USER_KEYS];
  const fuzzPer = Math.ceil(Number(a.fuzz) / fuzzUsers.length);
  const fuzz = Object.fromEntries(fuzzUsers.map((u) => [u, emptyFuzzResult()]));
  const callers = emptyCallerResult();
  const seq = emptySeqResult();
  const seqLaneResults = seqWorlds.map(() => emptySeqResult());

  // Each lane is started by the lane pool below (thunks), so that at most
  // --lanes app pages sets load from the dev servers at once.
  const fuzzLanes = (fuzzPer > 0 ? fuzzUsers : []).map((user) => () =>
    lane(`fuzz:${user}`, errors, async () => {
      const s = await session(b, main, user);
      const bases = Object.entries((await s.pages.new.evaluate(() => (window as any).__probe.bases())) as Record<string, any>).map(
        ([label, args]) => ({ label, args })
      );
      const cov = new Coverage();
      await runFuzzLane({ lane: user, session: s, world: main, rng: new Rng(`fuzz/${seed}/${user}`), coverage: cov, count: fuzzPer, bases, result: fuzz[user], log });
      coverage.merge(cov);
      await s.context.close();
    })
  );

  const callerLane = () => !a['no-callers']
    ? lane('callers', errors, async () => {
        for (const user of USER_KEYS) {
          const s = await session(b, main, user);
          const cov = new Coverage();
          await runCallerLane({ session: s, user, world: main, rng: new Rng(`callers/${seed}/${user}`), coverage: cov, result: callers, variants: 16, log });
          await runOneShots({ session: s, user, world: main, rng: new Rng(`oneshots/${seed}/${user}`), coverage: cov, result: callers });
          coverage.merge(cov);
          await s.context.close();
        }
      })
    : Promise.resolve();

  const perLane = Math.ceil(seqs / Math.max(1, seqLanes));
  const seqLanePromises = seqWorlds.map((w, k) => () =>
    lane(`seq:${k}`, errors, async () => {
      const viewer: UserKey = k % 2 === 0 ? 'owner' : 'member';
      const s = await session(b, w, viewer);
      const truth = await reopen(`truth ${w.tag} ${viewer}`, () => serialOpen(() => openTruthPage(b, w.users[viewer].email, origins.old, probePaths.old, w.users[viewer].browserCookies())));
      const cov = new Coverage();
      await runSequenceLane({
        world: w,
        viewer,
        session: s,
        truth,
        probePaths,
        rng: new Rng(`seq/${seed}/${k}`),
        coverage: cov,
        result: seqLaneResults[k],
        log: (line) => log(`lane ${k} ${line}`),
        length: Number(a.steps),
        count: perLane,
        ...(a.weights && { stepWeights: Object.fromEntries(a.weights.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) }),
      });
      coverage.merge(cov);
      await truth.context().close();
      await s.context.close();
    })
  );

  const mutantResults: Record<string, unknown> = {};
  const mutantLanes = mutantKinds.map((m, k) => () =>
    lane(`mutant:${m}`, errors, async () => {
      const w = mutantWorlds[k];
      const s = await session(b, w, 'owner');
      const planted = m === 'control' ? undefined : await plantMutant(s.pages.new, m);
      if (planted) {
        await s.pages.new.reload({ waitUntil: 'domcontentloaded' });
        // The probe import retries while Vite serves the reloaded module graph.
        await loadProbe(s, 'new', probePaths.new);
      }
      const truth = await serialOpen(() => openTruthPage(b, w.users.owner.email, origins.old, probePaths.old, w.users.owner.browserCookies()));
      const result = emptySeqResult();
      await runSequenceLane({
        world: w,
        viewer: 'owner',
        session: s,
        truth,
        probePaths,
        rng: new Rng(`mutant/${seed}`),
        coverage: new Coverage(),
        result,
        log: (line) => log(`mutant ${m} ${line}`),
        length: Number(a['mutant-steps']),
        count: 1,
        stepWeights: MUTANT_WEIGHTS,
        beforeReload: planted?.onReload,
      });
      const kinds: Record<string, number> = {};
      for (const f of result.failures) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
      mutantResults[m] = {
        caught: m === 'control' ? undefined : result.failures.length > 0,
        failures: result.failures.length,
        kinds,
        steps: result.steps,
        mutated: planted?.mutated,
        missed: planted?.missed,
        sample: result.failures.slice(0, 3).map((f) => ({ kind: f.kind, reader: f.reader, detail: f.detail })),
      };
      await truth.context().close();
      await s.context.close();
    })
  );

  // Sequences and mutants first: they are the longest lanes.
  await pool([...seqLanePromises, ...mutantLanes, ...fuzzLanes, callerLane], Number(a.lanes), (start) => start());
  for (const r of seqLaneResults) mergeSeq(seq, r);
  const loadStats = await load?.stop();

  out.fuzz = fuzz;
  out.callers = callers;
  out.sequences = seq;
  out.mutants = mutantResults;
  out.load = loadStats;
} finally {
  out.errors = errors;
  out.coverage = coverage.toJSON();
  (out.meta as Record<string, unknown>).finishedAt = new Date().toISOString();
  (out.meta as Record<string, unknown>).seconds = Math.round((Date.now() - started) / 1000);
  (out.meta as Record<string, unknown>).setupRetries = setupRetries;
  (out.meta as Record<string, unknown>).openRetries = openRetries;
  await Bun.write(a.out as string, JSON.stringify(out, null, 1));
  log(`wrote ${a.out}`);
  await closeBrowser();
}
