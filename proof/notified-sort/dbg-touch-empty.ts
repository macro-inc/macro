// Why a touch Home tab shows no rows: opens touch Home Signal for one viewer
// on both sides, waits, and prints each side's row count, console errors and
// page errors, and saves a screenshot. Reuses a latency run's world
// (DBG_WORLD, default out/latency-fix-quiet/world).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, readHomeDom, startApp, stopApp } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-touch-empty');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3806),
  lanes: 2,
  sizes: [100, 2000],
  outDir: join(here, process.env.DBG_WORLD ?? 'out/latency-fix-quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v0')!;
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { tab: 'signal', touch: process.env.DBG_TOUCH !== '0' })));
  const errors: string[][] = [[], []];
  lanes.forEach((lane, side) => {
    lane.page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors[side].push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    lane.page.on('pageerror', (e) => errors[side].push(`pageerror: ${String(e).slice(0, 300)}`));
  });
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 }).catch((e) => console.log(`grid: ${String(e).slice(0, 200)}`))));
  for (const wait of [3000, 10000, 20000]) {
    await new Promise((r) => setTimeout(r, wait));
    const dom = await Promise.all(lanes.map((lane) => readHomeDom(lane, 60)));
    console.log(`after +${wait}ms rows old=${dom[0].filter((r) => (r as { kind: string }).kind === 'entity').length} new=${dom[1].filter((r) => (r as { kind: string }).kind === 'entity').length}`);
  }
  await Promise.all(lanes.map((lane, side) => lane.page.screenshot({ path: join(out, `${side ? 'new' : 'old'}.png`) })));
  errors.forEach((list, side) => console.log(`${side ? 'new' : 'old'} errors (${list.length}):\n  ${[...new Set(list)].slice(0, 20).join('\n  ')}`));
} finally {
  await browser.close().catch(() => undefined);
  await Promise.all(apps.map(stopApp));
}
