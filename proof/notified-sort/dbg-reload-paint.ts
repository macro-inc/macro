// What Home paints in the seconds after a reload: one viewer's touch Home
// (DBG_TAB, default signal) on main (REST notified reader) and the branch, each
// reloaded DBG_RELOADS times (default 4). After each reload it reads Home every
// 300 ms for 20 s and prints, on change, the time since the reload, the row
// count, and the rows per entity type. A side that paints part of its list
// first (mail rows before the rest, say) shows as a short count that grows.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { parseRowId } from './lib/dom.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-reload-paint');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3301),
  lanes: Number(process.env.DBG_LANES ?? 24),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v1')!;
const tab = process.env.DBG_TAB ?? 'signal';
const reloads = Number(process.env.DBG_RELOADS ?? 4);
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();

async function watch(lane: Lane, label: string) {
  const start = Date.now();
  await reloadLane(lane);
  let last = '';
  while (Date.now() - start < 20_000) {
    const rows = await readHomeDom(lane).catch(() => []);
    const types: Record<string, number> = {};
    let n = 0;
    for (const row of rows) {
      if (row.kind !== 'entity') continue;
      n++;
      const type = parseRowId(row.id)?.type ?? '?';
      types[type] = (types[type] ?? 0) + 1;
    }
    const line = `${n} rows ${JSON.stringify(types)}`;
    if (line !== last) console.log(`${label} +${Date.now() - start}ms: ${line}`);
    last = line;
    await new Promise((r) => setTimeout(r, 300));
  }
}

try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  for (let i = 1; i <= reloads; i++) {
    for (const [side, lane] of lanes.entries()) await watch(lane, `reload ${i} ${side ? 'new' : 'old'}`);
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
