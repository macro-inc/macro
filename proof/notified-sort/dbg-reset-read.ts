// What a storage reset (R1) does to a read made right after a reload, and to
// the Home the viewer sees: the load run's reload check once read the
// branch's Home Signal empty, with no error, while main's read 30 rows. On one
// lane viewer (DBG_LANE, default v8 of the load world), DBG_TIMES times
// (default 10): reload both sides' touch Home, start the reload check's read
// of Home Signal (spec0: one page) on both, and DBG_CLEAR_MS ms into it
// (default 150) empty each side's cache the way a reset does. It prints each
// read's rows and the resets it saw, then, 10 s later, the rows Home shows and
// a fresh read's rows. Runs in the browser's own network namespace.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, readHomeDom, reloadLane, startApp, stopApp, type Lane, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-reset-read');
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
const times = Number(process.env.DBG_TIMES ?? 10);
const clearMs = Number(process.env.DBG_CLEAR_MS ?? 150);
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const at = () => new Date().toISOString();
const clear = (lane: Lane) => lane.page.evaluate(() => (window as never as { __proofProbe: { clearCache: () => Promise<string> } }).__proofProbe.clearCache());
const rows = (r: PromiseSettledResult<{ entities: unknown[]; error: string | null; resets?: unknown }>) =>
  r.status === 'fulfilled' ? { rows: r.value.entities.length, error: r.value.error, resets: r.value.resets } : { rejected: String(r.reason).slice(0, 120) };
const tally = { reads: 0, emptyOld: 0, emptyNew: 0, homeEmptyOld: 0, homeEmptyNew: 0, freshEmptyOld: 0, freshEmptyNew: 0 };
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true, path: '/app/home?s0.home.tab=signal' })));
  for (let i = 0; i < times; i++) {
    await Promise.all(lanes.map((lane) => reloadLane(lane, undefined, { probe: true })));
    const reading = Promise.allSettled(lanes.map((lane) => probeRead(lane, user.macroUserId, spec)));
    await new Promise((r) => setTimeout(r, clearMs));
    const cleared = await Promise.all(lanes.map((lane) => clear(lane).catch((e) => String(e).slice(0, 80))));
    const reads = (await reading).map(rows);
    await new Promise((r) => setTimeout(r, 10_000));
    const home = await Promise.all(lanes.map((lane) => readHomeDom(lane).then((d) => d.filter((r) => r.kind === 'entity').length, () => -1)));
    const fresh = (await Promise.allSettled(lanes.map((lane) => probeRead(lane, user.macroUserId, spec)))).map(rows);
    tally.reads += 1;
    const n = reads.map((r) => ('rows' in r ? r.rows : -1));
    const f = fresh.map((r) => ('rows' in r ? r.rows : -1));
    if (n[0] === 0) tally.emptyOld += 1;
    if (n[1] === 0) tally.emptyNew += 1;
    if (home[0] === 0) tally.homeEmptyOld += 1;
    if (home[1] === 0) tally.homeEmptyNew += 1;
    if (f[0] === 0) tally.freshEmptyOld += 1;
    if (f[1] === 0) tally.freshEmptyNew += 1;
    console.log(`${at()} #${i} cleared=${cleared.join('/')} read old=${JSON.stringify(reads[0])} new=${JSON.stringify(reads[1])} | +10s home old=${home[0]} new=${home[1]} fresh old=${f[0]} new=${f[1]}`);
  }
  console.log(JSON.stringify({ clearMs, ...tally }));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
