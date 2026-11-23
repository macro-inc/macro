// When does a mounted touch Home drop the rows of a channel the viewer was
// removed from? One lane viewer's Home (DBG_TAB, default signal) on each
// side: read before, run DBG_KIND (default participant-remove), read every
// 5 s for DBG_WAIT_S (default 60) with the page mounted, then run each step
// of DBG_THEN (default share-public,notify) and read every 5 s for 20 s after
// each, then reload. The rows each side's reload no longer has are the rows
// the write took away; every read prints which of them each side still shows.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, type ActionContext, type StepKind } from './lib/actions.ts';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import type { DomRow } from './lib/compare.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-access-loss');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3690),
  lanes: Number(process.env.DBG_LANES ?? 4),
  sizes: (process.env.DBG_SIZES ?? '0,1').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/dbg-access-loss/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: (line) => console.log(line),
  // DBG_REUSE=0 seeds the world; otherwise it must already be in the stack.
  reuse: process.env.DBG_REUSE !== '0',
});
const viewerKey = process.env.DBG_LANE ?? 'v0';
const user = seeded.users.get(viewerKey)!;
const tab = process.env.DBG_TAB ?? 'signal';
const waitS = Number(process.env.DBG_WAIT_S ?? 60);
const then = (process.env.DBG_THEN ?? 'share-public,notify').split(',').filter(Boolean) as StepKind[];
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const ids = (rows: DomRow[]) => rows.flatMap((r) => (r.kind === 'entity' ? [r.id] : []));
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
type Read = { label: string; t: number; rows: string[][] };
const reads: Read[] = [];
const t0 = Date.now();
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  // What reaches each page: deletion frames on the GraphQL websocket (type and
  // id only), and every Soup or notification read it sends (operation name),
  // with seconds since start. Lists only names and ids, never payloads.
  const events: string[] = [];
  const lastRequest = [Date.now(), Date.now()];
  const at = () => String(Math.round((Date.now() - t0) / 100) / 10).padStart(6);
  for (const [side, lane] of lanes.entries()) {
    const name = side ? 'new' : 'old';
    lane.page.on('websocket', (ws) => {
      events.push(`${at()}s ${name} ws open ${new URL(ws.url()).pathname}`);
      ws.on('close', () => events.push(`${at()}s ${name} ws close ${new URL(ws.url()).pathname}`));
      ws.on('framereceived', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString();
        for (const m of text.matchAll(/"__typename":"GraphqlCacheDeletion"[^}]*?"graphqlTypeName":"(\w+)"[^}]*?"entityId":"([\w-]+)"|"graphqlTypeName":"(\w+)"[^}]*?"entityId":"([\w-]+)"[^}]*?"__typename":"GraphqlCacheDeletion"/g)) {
          events.push(`${at()}s ${name} ws deletion ${m[1] ?? m[3]} ${m[2] ?? m[4]}`);
        }
      });
    });
    lane.page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      const body = req.postData() ?? '';
      const op = /"operationName"\s*:\s*"(\w+)"/.exec(body)?.[1] ?? /\b(?:query|mutation)\s+(\w+)/.exec(body)?.[1];
      if (op !== 'CalendarOccurrences') lastRequest[side] = Date.now();
      if (op) events.push(`${at()}s ${name} read ${op}`);
      else if (/\/soup|\/notification/.test(req.url())) events.push(`${at()}s ${name} rest ${new URL(req.url()).pathname}`);
    });
  }
  // The Soup GraphQL sockets pass through a route, so a step can close them.
  const soupSockets: { close: () => Promise<void> }[][] = [[], []];
  await Promise.all(lanes.map((lane, side) => lane.page.routeWebSocket(/soup\/graphql\/ws/, (ws) => {
    const server = ws.connectToServer();
    events.push(`${at()}s ${side ? 'new' : 'old'} soup socket open`);
    server.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      for (const m of text.matchAll(/"graphqlTypeName":"(\w+)"/g)) if (text.includes('GraphqlCacheDeletion')) events.push(`${at()}s ${side ? 'new' : 'old'} routed deletion ${m[1]}`);
      ws.send(message);
    });
    soupSockets[side].push(ws);
  })));
  // Listening from the load on, so the first socket's frames count too.
  await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
  const visibility = await Promise.all(lanes.map((lane) => lane.page.evaluate(() => document.visibilityState)));
  console.log(`visibility old=${visibility[0]} new=${visibility[1]}`);
  // Start only once both pages are done loading: 10 s without a read
  // (the calendar's 2 s poll aside), at most 3 min.
  for (const until = Date.now() + 180_000; Date.now() < until && lastRequest.some((t) => Date.now() - t < 10_000); ) await lanes[0].page.waitForTimeout(1000);
  console.log(`idle at ${Math.round((Date.now() - t0) / 1000)}s`);
  const read = async (label: string, wait = true) => {
    const rows = await Promise.all(lanes.map((lane) => (wait ? settled(lane) : readHomeDom(lane))));
    reads.push({ label, t: Math.round((Date.now() - t0) / 1000), rows: rows.map(ids) });
  };
  const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world: seeded.world, users: seeded.users, viewer: viewerKey, rng: new Rng(Number(process.env.DBG_RNG ?? 7)), created: [] };
  // DBG_ENTITY (a world key, default <lane>-priv) limits the first step to one entity.
  const only = process.env.DBG_ENTITY ?? `${viewerKey}-priv`;
  // DBG_PRE (step kinds, e.g. notify,done) run on that entity first, 20 s apart.
  for (const kind of (process.env.DBG_PRE ?? '').split(',').filter(Boolean)) {
    const pre = await runStep({ ...ctx, world: { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === only) } }, kind as StepKind);
    console.log(`pre ${JSON.stringify(pre)} at ${Math.round((Date.now() - t0) / 1000)}s`);
    await lanes[0].page.waitForTimeout(20_000);
  }
  await read('before');
  const step = await runStep({ ...ctx, world: { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === only) } }, (process.env.DBG_KIND ?? 'participant-remove') as StepKind);
  console.log(`step ${JSON.stringify(step)} at ${Math.round((Date.now() - t0) / 1000)}s`);
  const poll = async (label: string, seconds: number) => {
    for (let s = 5; s <= seconds; s += 5) {
      await lanes[0].page.waitForTimeout(5000);
      await read(`${label}+${s}s`, false);
    }
  };
  await poll(step.kind, waitS);
  for (const kind of then) {
    if (kind === ('reconnect' as StepKind)) {
      // Close both pages' Soup GraphQL sockets, as a dropped connection would.
      await Promise.all(soupSockets.flatMap((list) => list.splice(0).map((ws) => ws.close())));
      console.log(`step reconnect at ${Math.round((Date.now() - t0) / 1000)}s`);
      await poll(kind, 30);
      continue;
    }
    const next = await runStep(ctx, kind);
    console.log(`step ${JSON.stringify(next)} at ${Math.round((Date.now() - t0) / 1000)}s`);
    await poll(kind, 20);
  }
  await Promise.all(lanes.map((lane) => reloadLane(lane)));
  await read('reloaded');
  const last = reads[reads.length - 1].rows;
  const gone = reads[0].rows.map((before, side) => before.filter((id) => !last[side].includes(id)));
  console.log(`gone old: ${JSON.stringify(gone[0])}`);
  console.log(`gone new: ${JSON.stringify(gone[1])}`);
  for (const r of reads) {
    const held = r.rows.map((rows, side) => gone[side].filter((id) => rows.includes(id)).length);
    console.log(`${String(r.t).padStart(4)}s ${r.label.padEnd(26)} rows old ${r.rows[0].length} new ${r.rows[1].length}; gone rows still shown: old ${held[0]}/${gone[0].length} new ${held[1]}/${gone[1].length}`);
  }
  console.log('events:');
  for (const e of events) console.log(e);
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
