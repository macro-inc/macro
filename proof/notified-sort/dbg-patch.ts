// What touch Home shows after notification writes that arrive only as
// websocket patches: with Home mounted on main (REST), main with the flag
// off (GraphQL) and the branch, delete one entity's open notifications, then
// mark another entity's done, and read every Home after each write. Prints
// whether each entity's row is on screen, its text, and the notification
// patches each page received. DBG_WORLD names the world directory, DBG_LANE
// the viewer. Runs with PROOF_NETNS=0 (three dev servers).
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { parseRowId } from './lib/dom.ts';
import type { DomRow } from './lib/compare.ts';
import { seedWorld } from './lib/setup.ts';
import { call, q, sql, stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-patch');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 2950),
  lanes: Number(process.env.DBG_LANES ?? 8),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/diag3/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const user = seeded.users.get(process.env.DBG_LANE ?? 'v1')!;
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('old-flag-off', process.env.PROOF_OLD_WORKTREE ?? '', portBase + 2, { ...env, notifiedSort: false }, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const patches = new Map<Lane, string[]>();
const settled = async (lane: Lane) => {
  let previous = '';
  for (let i = 0; i < 8; i++) {
    await lane.page.waitForTimeout(1500);
    const rows = await readHomeDom(lane);
    if (JSON.stringify(rows) === previous) return rows;
    previous = JSON.stringify(rows);
  }
  return readHomeDom(lane);
};
const KINDS = new Set((process.env.DBG_KINDS ?? 'document,chat,email,project,calendar_event').split(','));
const openIds = (id: string) =>
  sql<{ id: string }>(stack, `SELECT notification_id::text AS id FROM user_notification WHERE user_id = ${q(user.macroUserId)} AND event_item_id = ${q(id)} AND deleted_at IS NULL AND state::text <> 'done'`).then((rows) => rows.map((r) => r.id));
const show = (label: string, lanes: Lane[], rows: DomRow[][], ids: string[]) => {
  console.log(`== ${label}`);
  for (const [i, lane] of lanes.entries()) {
    for (const id of ids) {
      const row = rows[i].find((r) => r.kind === 'entity' && parseRowId(r.id)?.id === id);
      console.log(`  ${lane.side.padEnd(12)} ${id.slice(0, 13)} ${row && row.kind === 'entity' ? `shown "${row.text.slice(0, 70)}"` : 'absent'}`);
    }
    console.log(`  ${lane.side.padEnd(12)} patches ${JSON.stringify(patches.get(lane))}`);
  }
};
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
  for (const lane of lanes) {
    patches.set(lane, []);
    lane.page.on('websocket', (ws) =>
      ws.on('framereceived', (frame) => {
        const text = typeof frame.payload === 'string' ? frame.payload : '';
        const kind = text.includes('notificationUpdates') ? (text.match(/Graphql(New|Updated)Notification|GraphqlCacheDeletion/)?.[0] ?? 'other') : null;
        if (kind) patches.get(lane)!.push(kind);
      })
    );
    // The page's websocket opened before the listener: load it again.
    await reloadLane(lane, `${lane.app.origin}/app/home`, { probe: true });
    await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 60_000 }).catch(async (error: unknown) => {
      await lane.page.screenshot({ path: join(out, `${lane.side}-timeout.png`) });
      console.log(lane.side, 'no Home grid at', lane.page.url());
      throw error;
    });
  }
  let rows = await Promise.all(lanes.map(settled));
  // Entities every Home shows, with open notifications to write to.
  const common: string[] = [];
  for (const r of rows[0]) {
    const e = r.kind === 'entity' ? parseRowId(r.id) : null;
    if (!e || !KINDS.has(e.type)) continue;
    if (!rows.every((list) => list.some((x) => x.kind === 'entity' && parseRowId(x.id)?.id === e.id))) continue;
    if ((await openIds(e.id)).length) common.push(e.id);
    if (common.length === 2) break;
  }
  if (common.length < 2) throw new Error(`need two shared rows with open notifications, found ${common.length}`);
  const [deleted, done] = common;
  show('mounted', lanes, rows, common);
  await call(stack, user, '/notification/user_notifications/bulk', { method: 'DELETE', body: { notificationIds: await openIds(deleted) } });
  await lanes[0].page.waitForTimeout(20_000);
  rows = await Promise.all(lanes.map(settled));
  show(`20 s after deleting ${deleted}'s open notifications`, lanes, rows, common);
  const doneIds = await openIds(done);
  await call(stack, user, '/notification/user_notifications/bulk/done', { method: 'PATCH', body: { notificationIds: doneIds } });
  await lanes[0].page.waitForTimeout(20_000);
  rows = await Promise.all(lanes.map(settled));
  show(`20 s after marking ${done}'s notifications done`, lanes, rows, common);
  // Where each page's query cache holds the done notification, and in what state.
  for (const lane of lanes) {
    const hits = await lane.page.evaluate((id) => (window as never as { __proofProbe: { findInCache: (n: string) => { key: string; snippet: string }[] } }).__proofProbe.findInCache(id), doneIds[0]);
    for (const hit of hits) {
      const at = hit.snippet.indexOf(doneIds[0]);
      const state = hit.snippet.slice(at).match(/"state":"(\w+)"/)?.[1];
      console.log(`  ${lane.side.padEnd(12)} cache ${hit.key.slice(0, 140)} state ${state}`);
    }
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
