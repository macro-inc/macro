// Closure L1's repro: Home's relative time labels on main and the branch.
// One viewer's touch Home (DBG_TAB, default noise) on each side. A mail
// thread gets a notification; its label is read 20 s later, then again after
// DBG_IDLE_MS (default 150 s) with no writes, then 20 s after a notification
// on a second mail thread, then after a reload. Prints the first thread's
// label on each side at each point. Expected: both read `now` and still `now`
// while idle (the label does not tick); after the second notification main's
// reads its age (its REST list refetched and mapped every row) and the
// branch's still reads `now` (the row is unchanged, so it is kept); after the
// reload both read its age.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, type ActionContext } from './lib/actions.ts';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-time-label');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3401),
  lanes: Number(process.env.DBG_LANES ?? 24),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const viewerKey = process.env.DBG_LANE ?? 'v0';
const user = seeded.users.get(viewerKey)!;
const tab = process.env.DBG_TAB ?? 'noise';
const idleMs = Number(process.env.DBG_IDLE_MS ?? 150_000);
const mails = seeded.world.entities.filter((e) => e.kind === 'email' && e.key.startsWith(`${viewerKey}-`));
if (mails.length < 2) throw new Error(`lane ${viewerKey} has ${mails.length} mail threads`);
const [first, second] = mails;
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notify = (entityKey: string) => {
  const world = { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === entityKey) };
  const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world, users: seeded.users, viewer: viewerKey, rng: new Rng(1), created: [] };
  return runStep(ctx, 'notify');
};
const label = async (lane: Lane) => {
  const rows = await readHomeDom(lane);
  const row = rows.find((r) => r.kind === 'entity' && r.id.includes(first.id));
  return row && row.kind === 'entity' ? (/(now|\d+(?:mo|m|h|d|w|y))$/.exec(row.text)?.[1] ?? row.text) : '<absent>';
};
const show = async (lanes: Lane[], at: string) => {
  const [o, n] = await Promise.all(lanes.map(label));
  console.log(`${new Date().toISOString()} ${at}: main ${o} · branch ${n}`);
};
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  await wait(10_000);
  await show(lanes, 'before');
  console.log(`notify ${first.key} ${JSON.stringify(await notify(first.key))}`);
  await wait(20_000);
  await show(lanes, 'first notification +20s');
  await wait(idleMs);
  await show(lanes, `idle +${Math.round(idleMs / 1000)}s`);
  console.log(`notify ${second.key} ${JSON.stringify(await notify(second.key))}`);
  await wait(20_000);
  await show(lanes, 'second notification +20s');
  await Promise.all(lanes.map((lane) => reloadLane(lane)));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  await wait(10_000);
  await show(lanes, 'reloaded');
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
