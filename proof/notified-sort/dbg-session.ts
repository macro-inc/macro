// What a mounted reader does across the app's own access-token refresh (about
// 15 minutes after a page loads): on main with the flag off and on the branch,
// one page with Home on screen and two probe readers mounted, Home Signal (n:
// GraphQL NOTIFIED_AT on the branch, REST on main) and the same filters by
// update time (u: GraphQL on both). Every three seconds for DBG_MINUTES
// (default 19) it prints, on change, Home's row count and each reader's state,
// with cache generation changes, websocket closes and token refreshes as they
// happen. Runs with PROOF_NETNS=0.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, openLane, probeOpenLive, readHomeDom, reloadLane, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-session');
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
const user = seeded.users.get(process.env.DBG_LANE ?? "v8")!;
const apps = await Promise.all([
  startApp('old-flag-off', process.env.PROOF_OLD_WORKTREE ?? '', portBase, { ...env, notifiedSort: false }, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const specs: Record<string, ReadSpec> = {
  n: { source: { kind: 'home', tab: 'signal', facets: {}, foreignEntities: true }, maxPages: 1 },
  u: { source: { kind: 'preset', tab: 'signal' }, params: { sort_method: 'updated_at' }, maxPages: 1 },
};
const browser = await launchBrowser();
const at = () => new Date().toISOString();
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  for (const lane of lanes) {
    lane.page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.endsWith('/jwt/refresh') || r.status() >= 400) console.log(`${at()} ${lane.side} ${r.status()} ${path}`);
    });
    lane.page.on('websocket', (ws) => ws.on('close', () => console.log(`${at()} ${lane.side} ws close ${new URL(ws.url()).pathname}`)));
    // Loaded again with the listeners on: this load refreshes the token, which
    // lapses about 15 minutes later (the transition watched).
    await reloadLane(lane, `${lane.app.origin}/app/home`, { probe: true });
    await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 120_000 });
    console.log(lane.side, 'watching generations', await lane.page.evaluate(() => (window as never as { __proofProbe: { watchGenerations: () => boolean } }).__proofProbe.watchGenerations()));
    for (const [id, spec] of Object.entries(specs)) {
      const r = await probeOpenLive(lane, id, user.macroUserId, spec);
      console.log(lane.side, id, 'opened', r.transport, r.entities.length, r.error ?? '');
    }
  }
  const started = Date.now();
  const last = new Map<string, string>();
  const seenGen = new Map<string, number>();
  for (let s = 0; Date.now() - started < Number(process.env.DBG_MINUTES ?? 19) * 60_000; s++) {
    if (s === Number(process.env.DBG_CLEAR_AT ?? -1)) for (const lane of lanes) console.log(`${at()} ${lane.side} clearCache`, await lane.page.evaluate(() => (window as never as { __proofProbe: { clearCache: () => Promise<string> } }).__proofProbe.clearCache()));
    for (const lane of lanes) {
      const home = (await readHomeDom(lane)).filter((r) => r.kind === 'entity').length;
      const state = await lane.page.evaluate(() => {
        const p = (window as never as { __proofProbe: { liveDebug: (id: string) => unknown; generations: () => unknown[] } }).__proofProbe;
        return { n: p.liveDebug('n'), u: p.liveDebug('u'), gens: p.generations() };
      });
      const line = `home=${home} n=${JSON.stringify(state.n)} u=${JSON.stringify(state.u)}`;
      const gens = state.gens as unknown[];
      for (const g of gens.slice(seenGen.get(lane.side) ?? 0)) console.log(`${at()} ${lane.side} generation ${JSON.stringify(g)}`);
      seenGen.set(lane.side, gens.length);
      if (line !== last.get(lane.side) || s % 40 === 0) console.log(`${at()} t=${Math.round((Date.now() - started) / 1000)}s ${lane.side} ${line}`);
      last.set(lane.side, line);
    }
    await lanes[0].page.waitForTimeout(3000);
  }
  for (const lane of lanes) await lane.page.screenshot({ path: join(out, `${lane.side}-end.png`) });
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
