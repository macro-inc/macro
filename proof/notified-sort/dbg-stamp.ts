// Whether a grouped REST row keeps the stamp a delivered notification puts on
// it, on main and on the branch, quiet and under a notification storm (two
// loaded reads, 1250 and 1289 of load-reads seed 3703, showed rows with
// notifiedAt on the branch only; chk-stamp.ts). Grouped lists are REST on both
// sides and grouped pages carry no notified_at, so the stamp is the tab's own.
//
// The DBG_VIEWER (default n101) of a seeded world (DBG_WORLD, default the
// load-reads world) opens desktop Home on both sides. Each round notifies
// DBG_TRACK (default 4) of the viewer's documents, waits 12 s, and reads
// Home Signal and Noise grouped by date (99 rows, one page, from the cache, as
// read 1250) on both sides. For every tracked document that both reads list,
// it records whether each side carries notifiedAt and whether that is the
// viewer's latest notification time for it. Phase "quiet" runs DBG_ROUNDS
// (default 6) rounds alone; phase "storm" runs as many while DBG_RATE (default
// 15) notifications a second go to the viewer about any of its entities.
// Prints a tally per phase and side. Runs in the browser's network namespace.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, reloadLane, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { queueNotify } from './lib/notify.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld, sender } from './lib/setup.ts';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-stamp');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3703),
  lanes: 24,
  sizes: [0, 1, 100, 101, 2000],
  outDir: join(here, process.env.DBG_WORLD ?? 'out/load-reads/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const viewerKey = process.env.DBG_VIEWER ?? 'n101';
const user = seeded.users.get(viewerKey)!;
const mine = seeded.world.entities.filter((e) => e.viewer === viewerKey);
const docs = mine.filter((e) => e.itemType === 'document');
const others = mine;
const track = Number(process.env.DBG_TRACK ?? 4);
const rounds = Number(process.env.DBG_ROUNDS ?? 6);
const rate = Number(process.env.DBG_RATE ?? 15);
const queue = process.env.PROOF_QUEUE_URL ?? '';
const spec = (tab: 'signal' | 'noise'): ReadSpec => ({
  source: { kind: 'preset', tab },
  params: { limit: 99, sort_method: 'notified_at', sort_direction: 'desc' },
  groupBy: { type: 'date' },
  showForeign: true,
  maxPages: 1,
});
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const at = () => new Date().toISOString();
const rng = new Rng(91);
type Tally = { listed: number; stamped: number; latest: number; missing: number; readErrors: number };
const tally: Record<string, Record<'old' | 'new', Tally>> = {};
const blank = (): Tally => ({ listed: 0, stamped: 0, latest: 0, missing: 0, readErrors: 0 });
async function latest(id: string): Promise<string | null> {
  const [row] = await sql<{ at: string | null }>(
    stack,
    `SELECT to_char(max(un.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at FROM user_notification un WHERE un.user_id = ${q(user.macroUserId)} AND un.event_item_id = ${q(id)}`
  );
  return row?.at ?? null;
}
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: false, path: '/app/home?s0.home.tab=signal' })));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  for (const lane of lanes) lane.page.on('crash', () => console.log(`${at()} ${lane.side} page crashed`));
  // Frames each tab receives over its websockets (the connection gateway
  // delivers notifications there), and sockets that closed.
  const frames = { old: 0, new: 0 }, closed = { old: 0, new: 0 };
  for (const lane of lanes) {
    const side = lane.side as 'old' | 'new';
    lane.page.on('websocket', (ws) => {
      ws.on('framereceived', () => (frames[side] += 1));
      ws.on('close', () => (closed[side] += 1));
    });
  }
  // Reload once so the sockets open under the listeners.
  await Promise.all(lanes.map((lane) => reloadLane(lane, undefined, { probe: true })));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  await new Promise((r) => setTimeout(r, 10_000));
  for (const phase of ['quiet', 'storm'] as const) {
    tally[phase] = { old: blank(), new: blank() };
    let running = phase === 'storm';
    let sent = 0;
    const storm = (async () => {
      while (running) {
        const tick = Date.now();
        await Promise.all(Array.from({ length: rate }, () => rng.pick(others)).map((e) => queueNotify(stack, queue, e, [user.macroUserId], sender(seeded.world, e), rng, { waitMs: 1 }).then(() => (sent += 1), () => undefined)));
        await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - tick))));
      }
    })();
    for (let round = 0; round < rounds; round++) {
      const tracked = Array.from({ length: track }, () => rng.pick(docs));
      for (const e of tracked) await queueNotify(stack, queue, e, [user.macroUserId], sender(seeded.world, e), rng, { waitMs: 1 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 12_000));
      const reads = await Promise.all(
        lanes.map(async (lane) => {
          const rows = new Map<string, unknown>();
          let errors = 0;
          for (const tab of ['signal', 'noise'] as const) {
            const r = await probeRead(lane, user.macroUserId, spec(tab)).catch((e) => ({ entities: [], error: String(e).slice(0, 80) }));
            if (r.error) errors += 1;
            for (const entity of r.entities as { id: string; notifiedAt?: string }[]) rows.set(entity.id, entity.notifiedAt);
          }
          return { side: lane.side as 'old' | 'new', rows, errors };
        })
      );
      const line: string[] = [];
      for (const e of new Set(tracked)) {
        if (!reads.every((r) => r.rows.has(e.id))) continue;
        const truth = await latest(e.id);
        for (const r of reads) {
          const t = tally[phase][r.side];
          const v = r.rows.get(e.id) as string | undefined;
          t.listed += 1;
          if (v) t.stamped += 1;
          else t.missing += 1;
          if (v && truth && v.startsWith(truth)) t.latest += 1;
        }
        line.push(`${e.id.slice(-6)} old=${reads[0].rows.get(e.id) ?? '-'} new=${reads[1].rows.get(e.id) ?? '-'} truth=${truth}`);
      }
      for (const r of reads) tally[phase][r.side].readErrors += r.errors;
      console.log(`${at()} ${phase} round ${round} sent=${sent} ws-frames old=${frames.old} new=${frames.new} ws-closed old=${closed.old} new=${closed.new} errors old=${reads[0].errors} new=${reads[1].errors} ${line.join(' | ')}`);
    }
    running = false;
    await storm;
  }
  console.log(JSON.stringify(tally));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
