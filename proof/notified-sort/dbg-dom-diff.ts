// Touch Home on both sides for one lane viewer of an existing world, read
// as a fresh load: prints the caller-level differences and, for every row
// one side shows that the other lacks, the row, plus what the database
// holds for that entity's notifications. DBG_WORLD names the world
// directory, DBG_LANE the viewer, DBG_TAB the pill (default signal).
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, openLane, readHomeDom, reloadLane, startApp, stopApp, type Lane } from './lib/browser.ts';
import { compareHomeDom, parseRowId } from './lib/dom.ts';
import { seedWorld } from './lib/setup.ts';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-dom-diff');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 2900),
  lanes: Number(process.env.DBG_LANES ?? 8),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/diag2/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const tab = process.env.DBG_TAB ?? 'signal';
const viewers = (process.env.DBG_LANE ?? 'v5').split(',');
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
  for (const viewerKey of viewers) {
    const user = seeded.users.get(viewerKey)!;
    const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: true })));
    await Promise.all(lanes.map((lane) => reloadLane(lane, `${lane.app.origin}/app/home?s0.home.tab=${tab}`)));
    const rows = await Promise.all(lanes.map(settled));
    const diffs = await compareHomeDom(stack, user, rows[0], rows[1], `${viewerKey} ${tab}`);
    console.log(`${viewerKey}: old ${rows[0].length} rows, new ${rows[1].length}; ${diffs.length} differences`);
    for (const d of diffs) console.log(`  ${d.signature}: ${d.detail}`);
    const ids = rows.map((list) => new Set(list.flatMap((r) => (r.kind === 'entity' ? [r.id] : []))));
    for (const [side, list] of rows.entries()) {
      for (const [at, row] of list.entries()) {
        if (row.kind !== 'entity' || ids[1 - side].has(row.id)) continue;
        const e = parseRowId(row.id);
        const notes = e
          ? await sql<{ state: string; created_at: string; deleted: string | null; seen: string | null }>(
              stack,
              `SELECT state::text AS state, created_at::text, deleted_at::text AS deleted, seen_at::text AS seen FROM user_notification WHERE user_id = ${q(user.macroUserId)} AND event_item_id = ${q(e.id)} ORDER BY created_at`
            ).catch((err: unknown) => [{ state: `query failed: ${String(err).slice(0, 200)}`, created_at: '', deleted: null, seen: null }])
          : [];
        console.log(`  only ${side ? 'new' : 'old'} at ${at}: ${row.id} "${row.text}" notifications ${JSON.stringify(notes)}`);
      }
    }
    for (const lane of lanes) await lane.page.context().close();
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
