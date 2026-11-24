// Whether a read right after a reload can settle empty: the sequences'
// reload check (run.ts step 3) on one lane viewer, DBG_TIMES times (default
// 40): reload both sides' pages, then read Home Signal (spec0 of every
// sequence: one page, from the cache if it has it) on both. Prints every read
// whose row count differs between the sides, with the empty side's state. The
// renderer's CPU is slowed DBG_CPU times (default 1: not) to stand in for the
// loaded machine. Runs with PROOF_NETNS=0.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, reloadLane, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-reload-empty');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3702),
  lanes: 24,
  sizes: [0, 1, 100, 101, 2000],
  outDir: join(here, process.env.DBG_WORLD ?? 'out/load/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v8')!;
const spec: ReadSpec = { source: { kind: 'home', tab: 'signal', facets: {}, foreignEntities: true }, maxPages: 1 };
const times = Number(process.env.DBG_TIMES ?? 40);
const cpu = Number(process.env.DBG_CPU ?? 1);
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const at = () => new Date().toISOString();
const tally = { reads: 0, differ: 0, emptyOld: 0, emptyNew: 0 };
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user)));
  for (const lane of lanes) {
    if (cpu > 1) await (await lane.page.context().newCDPSession(lane.page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  for (let i = 0; i < times; i++) {
    await Promise.all(lanes.map((lane) => reloadLane(lane, undefined, { probe: true })));
    const reads = await Promise.allSettled(lanes.map((lane) => probeRead(lane, user.macroUserId, spec)));
    tally.reads += 1;
    const n = reads.map((r) => (r.status === 'fulfilled' ? r.value.entities.length : -1));
    if (n[0] !== n[1]) {
      tally.differ += 1;
      if (n[0] === 0) tally.emptyOld += 1;
      if (n[1] === 0) tally.emptyNew += 1;
      const state = reads.map((r) => (r.status === 'fulfilled' ? { transport: r.value.transport, error: r.value.error, ms: r.value.ms, hasNextPage: r.value.hasNextPage } : String(r.reason).slice(0, 160)));
      console.log(`${at()} #${i} rows old=${n[0]} new=${n[1]} ${JSON.stringify(state)}`);
    } else if (i % 10 === 0) console.log(`${at()} #${i} rows old=${n[0]} new=${n[1]}`);
  }
  console.log(JSON.stringify(tally));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
