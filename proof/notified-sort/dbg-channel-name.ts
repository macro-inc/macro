// Touch Home on both sides for one lane viewer as a fresh load, then watch
// every channel thread row's text for DBG_WATCH_MS: prints each tick where
// the two sides name the row's channel differently, the first tick they
// agree, and the same after a reload. Each tick also compares the whole Home
// as the run does (lib/dom.ts compareHomeDom) and prints its classes when
// they change. DBG_WORLD names the world directory,
// DBG_LANE the viewer, DBG_TAB the pill (default signal).
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { compareHomeDom } from './lib/dom.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-channel-name');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3501),
  lanes: Number(process.env.DBG_LANES ?? 24),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const tab = process.env.DBG_TAB ?? 'signal';
const watchMs = Number(process.env.DBG_WATCH_MS ?? 60_000);
const viewerKey = process.env.DBG_LANE ?? 'v2';
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const threadRows = async (lane: Lane) =>
  new Map((await readHomeDom(lane)).flatMap((r) => (r.kind === 'entity' && r.id.includes('channel_thread') ? [[r.id, r.text] as const] : [])));
const watch = async (lanes: Lane[], label: string, user: Parameters<typeof compareHomeDom>[1]) => {
  const start = Date.now();
  let agreed = false;
  let lastClasses = '';
  while (Date.now() - start < watchMs) {
    const [old, neu] = await Promise.all(lanes.map(threadRows));
    const differ = [...old].filter(([id, text]) => neu.has(id) && neu.get(id) !== text);
    const t = ((Date.now() - start) / 1000).toFixed(1);
    if (differ.length) for (const [id, text] of differ) console.log(`${label} +${t}s differ ${id.slice(0, 90)}: old "${text.slice(0, 40)}" new "${neu.get(id)!.slice(0, 40)}"`);
    else if (!agreed) console.log(`${label} +${t}s agree on ${[...old.keys()].filter((id) => neu.has(id)).length} thread rows: ${[...old.values()].map((s) => s.slice(0, 24)).join(' | ')}`);
    agreed = !differ.length;
    const full = await Promise.all(lanes.map((lane) => readHomeDom(lane)));
    const classes = JSON.stringify((await compareHomeDom(stack, user, full[0], full[1], label)).map((d) => (d.signature.endsWith('channel-name-snapshot') ? `${d.signature} [${d.detail.slice(0, 160)}]` : d.signature)));
    if (classes !== lastClasses) console.log(`${label} +${t}s whole Home (${full[0].length}/${full[1].length} rows): ${classes}`);
    lastClasses = classes;
    await lanes[0].page.waitForTimeout(2000);
  }
};
try {
  const user = seeded.users.get(viewerKey)!;
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  await watch(lanes, 'first load', user);
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  await watch(lanes, 'reload', user);
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
