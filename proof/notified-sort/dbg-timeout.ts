// What each side shows when the server takes longer than main's Soup request
// deadline: one lane viewer reads Home Signal (fresh) on each side while every
// Soup list request (main's REST /soup/ast*, the branch's /soup/graphql) is
// held DBG_DELAYS seconds (comma-separated, default 5,13) before it goes out.
// Prints each side's error, row count and time taken per delay.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-timeout');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 2691),
  lanes: Number(process.env.DBG_LANES ?? 4),
  sizes: (process.env.DBG_SIZES ?? '0,1').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/dbg-seq/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v0')!;
const spec: ReadSpec = { source: { kind: 'home', tab: 'signal', facets: {}, foreignEntities: true }, maxPages: 1, fresh: !process.env.DBG_ABORT, clean: true };
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user)));
  let delayMs = 0;
  // DBG_ABORT=<Playwright error code> instead fails each side's first Soup
  // list request of a read at the network (aborted, connectionreset, ...).
  const abortNext = new Set<string>();
  for (const lane of lanes) {
    await lane.page.route(/\/dss\/items\/soup\/(ast|graphql)/, async (route) => {
      if (process.env.DBG_ABORT && abortNext.delete(lane.side)) return route.abort(process.env.DBG_ABORT);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  }
  for (const seconds of (process.env.DBG_DELAYS ?? '5,13').split(',').map(Number)) {
    delayMs = seconds * 1000;
    const results = await Promise.all(
      lanes.map(async (lane) => {
        const started = Date.now();
        abortNext.add(lane.side);
        try {
          const read = await probeRead(lane, user.macroUserId, spec);
          return `${lane.side}: transport=${read.transport} error=${read.error ?? null} rows=${read.entities.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`;
        } catch (error) {
          return `${lane.side}: probe threw ${String(error).slice(0, 160)} in ${((Date.now() - started) / 1000).toFixed(1)}s`;
        }
      })
    );
    console.log(`delay ${seconds}s | ${results.join(' | ')}`);
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
