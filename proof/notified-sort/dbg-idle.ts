// Whether Home stays filled across the app's own access-token refresh: Home
// mounted on main (REST) and the branch, left idle, read every 30 seconds for
// DBG_MINUTES (default 20), printing each page's row count and every token
// refresh and websocket close as it happens. Runs with PROOF_NETNS=0.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-idle');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3001),
  lanes: Number(process.env.DBG_LANES ?? 24),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v6')!;
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
  // Main with the flag off: Home on GraphQL Soup, by its own sort.
  startApp('old-flag-off', process.env.PROOF_OLD_WORKTREE ?? '', portBase + 2, { ...env, notifiedSort: false }, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const at = () => new Date().toISOString();
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  for (const lane of lanes) {
    lane.page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.endsWith('/jwt/refresh') || r.status() === 401) console.log(`${at()} ${lane.side} ${r.status()} ${path}`);
    });
    lane.page.on('websocket', (ws) => ws.on('close', () => console.log(`${at()} ${lane.side} ws close ${new URL(ws.url()).pathname}`)));
    await reloadLane(lane, `${lane.app.origin}/app/home`, { probe: true });
    await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 120_000 });
  }
  const minutes = Number(process.env.DBG_MINUTES ?? 20);
  // Every two seconds; a line only when a count changes, and a summary each minute.
  let last = '';
  const started = Date.now();
  for (let s = 0; Date.now() - started < minutes * 60_000; s += 1) {
    const rows = await Promise.all(lanes.map((lane) => readHomeDom(lane)));
    const counts = rows.map((list) => list.filter((r) => r.kind === 'entity').length);
    const line = lanes.map((l, i) => `${l.side}=${counts[i]}`).join(' ');
    if (line !== last || s % 30 === 0) console.log(`${at()} t=${Math.round((Date.now() - started) / 1000)}s rows ${line}`);
    if (line !== last && last) for (const [i, lane] of lanes.entries()) await lane.page.screenshot({ path: join(out, `${lane.side}-${s}.png`) });
    last = line;
    await lanes[0].page.waitForTimeout(2000);
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
