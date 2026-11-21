// Times lane document loads: one at a time, then N at once, then reloads.
// PROOF_NETNS=0 compares without the browser's network namespace.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, reloadLane, startApp, stopApp } from './lib/browser.ts';
import { moduleCacheStats } from './lib/module-cache.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-loadtime');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, { seed: Number(process.env.PROOF_SEED ?? 2301), lanes: 24, sizes: [0, 1, 100, 101, 2000], outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'), repo: process.env.PROOF_REPO ?? '', instance: stack.instance, log: console.log, reuse: true });
const user = seeded.users.get('v0')!;
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const time = async (label: string, f: () => Promise<unknown>) => { const t = Date.now(); const r0 = moduleCacheStats.requests; const c0 = moduleCacheStats.cacheable; await f(); console.log(label, `requests ${moduleCacheStats.requests - r0} (cacheable ${moduleCacheStats.cacheable - c0})`, ((Date.now() - t) / 1000).toFixed(1), 's'); };
try {
  let lane = await openLane(browser, oldApp, user);
  await time('open one (old, warm vite)', async () => { lane = await openLane(browser, oldApp, user); });
  for (let i = 0; i < 2; i++) await time(`reload one #${i}`, () => reloadLane(lane, undefined, { probe: true }));
  const n = Number(process.env.DBG_N ?? 6);
  const lanes = await Promise.all(Array.from({ length: n }, (_, i) => openLane(browser, i % 2 ? newApp : oldApp, user)));
  await time(`reload ${n} at once`, () => Promise.all(lanes.map((l) => reloadLane(l, undefined, { probe: true }))));
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
