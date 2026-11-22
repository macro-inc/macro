// Where a Home mail row's time label comes from when the thread has no open
// notification. One viewer's touch Home (DBG_TAB, default signal) on main
// and the branch. DBG_THREAD names a mail thread whose notifications for the
// viewer are all done. For DBG_WATCH_MS (default 180 s) it prints, on
// change, the row's label on each side, and every response that carries the
// thread (GraphQL operation or REST path) with the updatedAt it gives it.
// DBG_STEPS (kind:entity-key, comma-separated) then run one by one, 20 s
// apart, each followed by the label on each side. Then it reloads both and
// prints the label again.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, type ActionContext, type StepKind } from './lib/actions.ts';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-email-label');
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
const user = seeded.users.get(process.env.DBG_LANE ?? 'v7')!;
const thread = process.env.DBG_THREAD ?? '';
if (!thread) throw new Error('set DBG_THREAD to a mail thread id');
const tab = process.env.DBG_TAB ?? 'signal';
const watchMs = Number(process.env.DBG_WATCH_MS ?? 180_000);
const states = await sql<{ state: string; n: string }>(stack, `SELECT state::text AS state, count(*)::text AS n FROM user_notification WHERE user_id = ${q(user.macroUserId)} AND event_item_id = ${q(thread)} AND deleted_at IS NULL GROUP BY 1`);
const times = await sql<{ updated_at: string; latest: string }>(stack, `SELECT updated_at::text, latest_non_spam_message_ts::text AS latest FROM email_threads WHERE id = ${q(thread)}`);
console.log(`thread notifications ${JSON.stringify(states)}; email_threads ${JSON.stringify(times)}`);
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const started = Date.now();
const at = () => `+${Math.round((Date.now() - started) / 1000)}s`;

/** Every updatedAt given to the thread anywhere in a JSON body. */
function updatedAtsFor(body: unknown, id: string): string[] {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if ((o.id === id || o.threadId === id || o.thread_id === id) && ('updatedAt' in o || 'updated_at' in o)) found.push(String(o.updatedAt ?? o.updated_at));
    Object.values(o).forEach(walk);
  };
  walk(body);
  return found;
}

function watchResponses(lane: Lane) {
  lane.page.on('response', async (response) => {
    try {
      const text = await response.text();
      if (!text.includes(thread)) return;
      const url = new URL(response.url());
      let op = url.pathname;
      const post = response.request().postData();
      if (post?.includes('operationName')) op = `${url.pathname} ${JSON.parse(post).operationName}`;
      const values = updatedAtsFor(JSON.parse(text), thread);
      console.log(`${at()} ${lane.side} response ${op}: updatedAt ${JSON.stringify(values)}`);
    } catch {
      // Non-JSON bodies (assets, streams) carry no record.
    }
  });
  lane.page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
      if (text.includes(thread)) console.log(`${at()} ${lane.side} websocket frame: ${text.slice(0, 300)}`);
    });
  });
}

const label = async (lane: Lane) => {
  const rows = await readHomeDom(lane).catch(() => []);
  const row = rows.find((r) => r.kind === 'entity' && r.id.includes(thread));
  return row && row.kind === 'entity' ? (/(now|\d+(?:mo|m|h|d|w|y))$/.exec(row.text)?.[1] ?? row.text) : '<absent>';
};

try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  lanes.forEach(watchResponses);
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  let last = '';
  while (Date.now() - started < watchMs) {
    const now = (await Promise.all(lanes.map(label))).join(' · ');
    if (now !== last) console.log(`${at()} label main · branch: ${now}`);
    last = now;
    await new Promise((r) => setTimeout(r, 3000));
  }
  for (const step of (process.env.DBG_STEPS ?? '').split(',').filter(Boolean)) {
    const [kind, key] = step.split(':');
    const world = { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === key || (kind === 'move' && e.kind === 'project')) };
    const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world, users: seeded.users, viewer: process.env.DBG_LANE ?? 'v7', rng: new Rng(1), created: [] };
    console.log(`${at()} step ${step}: ${JSON.stringify(await runStep(ctx, kind as StepKind))}`);
    await new Promise((r) => setTimeout(r, 20_000));
    console.log(`${at()} after ${step} label main · branch: ${(await Promise.all(lanes.map(label))).join(' · ')}`);
  }
  await Promise.all(lanes.map((lane) => reloadLane(lane)));
  await new Promise((r) => setTimeout(r, 20_000));
  console.log(`${at()} reloaded label main · branch: ${(await Promise.all(lanes.map(label))).join(' · ')}`);
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
