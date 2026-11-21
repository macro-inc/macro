// What Home shows for the entity a write step touched: one lane viewer's
// touch Home (DBG_TAB, default signal) on each side, read before the step,
// 15 s after it with the page still mounted, and after a reload. Prints the
// touched entity's row (position, text, unread) on each side at each point.
// DBG_KIND picks the step (default rename), DBG_RNG the entity it picks, and
// DBG_ENTITY (a world key) limits the pick to one entity.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, type ActionContext, type StepKind } from './lib/actions.ts';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-dom-step');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 2690),
  lanes: Number(process.env.DBG_LANES ?? 4),
  sizes: (process.env.DBG_SIZES ?? '0,1').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/dbg-seq/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const viewerKey = process.env.DBG_LANE ?? 'v0';
const user = seeded.users.get(viewerKey)!;
const tab = process.env.DBG_TAB ?? 'signal';
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const settled = async (lane: Lane) => {
  await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 });
  let previous = '';
  for (let i = 0; i < 8; i++) {
    await lane.page.waitForTimeout(1500);
    const rows = await readHomeDom(lane);
    if (JSON.stringify(rows) === previous) return rows;
    previous = JSON.stringify(rows);
  }
  return readHomeDom(lane);
};
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  const show = async (label: string, entityId: string | undefined) => {
    const rows = await Promise.all(lanes.map(settled));
    for (const [side, list] of rows.entries()) {
      const at = entityId ? list.findIndex((r) => 'id' in r && r.id.includes(entityId)) : -1;
      const row = at >= 0 ? list[at] : undefined;
      console.log(`${label} ${side ? 'new' : 'old'}: ${list.length} rows; entity at ${at}: ${JSON.stringify(row ?? null)}`);
    }
    const [a, b] = rows.map((list) => list.map((r) => JSON.stringify(r)));
    const firstDiff = a.findIndex((r, i) => r !== b[i]);
    console.log(`${label} sides ${firstDiff < 0 && a.length === b.length ? 'agree' : `part at row ${firstDiff}: ${a[firstDiff]} vs ${b[firstDiff]}`}`);
  };
  await show('before', process.env.DBG_ENTITY ? seeded.world.entities.find((e) => e.key === process.env.DBG_ENTITY)?.id : undefined);
  const only = process.env.DBG_ENTITY;
  const world = only ? { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === only) } : seeded.world;
  const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world, users: seeded.users, viewer: viewerKey, rng: new Rng(Number(process.env.DBG_RNG ?? 7)), created: [] };
  const step = await runStep(ctx, (process.env.DBG_KIND ?? 'rename') as StepKind);
  const entity = seeded.world.entities.find((e) => e.key === step.entity) ?? ctx.created.find((e) => e.key === step.entity);
  console.log(`step ${JSON.stringify(step)} id ${entity?.id}`);
  await new Promise((r) => setTimeout(r, 15_000));
  await show('mounted+15s', entity?.id);
  await Promise.all(lanes.map((lane) => reloadLane(lane)));
  await show('reloaded', entity?.id);
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
