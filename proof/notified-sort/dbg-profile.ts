// Where each tab's main thread goes during a notification storm, and how far
// behind it falls. dbg-stamp.ts showed both desktop Homes keeping each row's
// notification time under a storm of DBG_RATE (default 15) a second to one
// viewer, but behind the database: main by up to ~30 s, the branch by up to
// ~55 s, with the branch's tab also counting fewer websocket frames for a
// while. This runs the same setup (DBG_VIEWER, default n101 of the load-reads
// world) and, per round, prints for each side: how far behind the database
// its tracked rows' stamps are, the longest main-thread stall (a 100 ms timer's
// lateness), and websocket frames. It records a CPU profile of each tab over
// storm rounds DBG_FROM..DBG_TO (default 1..4) and prints the functions with
// the most self time, and the app functions with the most time under them.
// Runs in the browser's network namespace.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, reloadLane, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { queueNotify } from './lib/notify.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld, sender } from './lib/setup.ts';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-profile');
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
const track = Number(process.env.DBG_TRACK ?? 4);
const quietRounds = Number(process.env.DBG_QUIET ?? 2);
const rounds = Number(process.env.DBG_ROUNDS ?? 6);
const rate = Number(process.env.DBG_RATE ?? 15);
const from = Number(process.env.DBG_FROM ?? 1);
const to = Number(process.env.DBG_TO ?? 4);
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
const rng = new Rng(92);
async function latest(id: string): Promise<string | null> {
  const [row] = await sql<{ at: string | null }>(
    stack,
    `SELECT to_char(max(un.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at FROM user_notification un WHERE un.user_id = ${q(user.macroUserId)} AND un.event_item_id = ${q(id)}`
  );
  return row?.at ?? null;
}

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
type Profile = { nodes: Node[]; samples: number[]; timeDeltas: number[] };
/** Self time per function, and time under each app function (inclusive), in ms. */
function summarize(profile: Profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (n: Node) => {
    const file = n.callFrame.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
    return `${n.callFrame.functionName || '(anonymous)'} ${file ? `${file}:${n.callFrame.lineNumber + 1}` : ''}`.trim();
  };
  const self = new Map<string, number>();
  const incl = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    const node = byId.get(id)!;
    self.set(name(node), (self.get(name(node)) ?? 0) + ms);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const n = byId.get(cur)!;
      if (!/\/src\//.test(n.callFrame.url)) continue;
      const key = name(n);
      if (seen.has(key)) continue;
      seen.add(key);
      incl.set(key, (incl.get(key) ?? 0) + ms);
    }
  });
  const top = (m: Map<string, number>, k: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([f, ms]) => `${ms.toFixed(0).padStart(7)} ms  ${f}`);
  const idle = self.get('(idle)') ?? 0;
  return { total, idle, busy: total - idle, self: top(self, 20), incl: top(incl, 30) };
}

try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: false, path: '/app/home?s0.home.tab=signal' })));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  const frames = { old: 0, new: 0 };
  for (const lane of lanes) {
    const side = lane.side as 'old' | 'new';
    lane.page.on('crash', () => console.log(`${at()} ${side} page crashed`));
    lane.page.on('websocket', (ws) => ws.on('framereceived', () => (frames[side] += 1)));
  }
  await Promise.all(lanes.map((lane) => reloadLane(lane, undefined, { probe: true })));
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  // A 100 ms timer whose lateness is the longest the main thread was busy.
  const installLag = () =>
    Promise.all(
      lanes.map((lane) =>
        lane.page.evaluate(() => {
          const w = window as never as { __lagMax: number; __lagLast: number };
          w.__lagMax = 0;
          w.__lagLast = performance.now();
          setInterval(() => {
            const now = performance.now();
            w.__lagMax = Math.max(w.__lagMax, now - w.__lagLast - 100);
            w.__lagLast = now;
          }, 100);
        })
      )
    );
  const takeLag = () => Promise.all(lanes.map((lane) => lane.page.evaluate(() => { const w = window as never as { __lagMax: number }; const m = w.__lagMax; w.__lagMax = 0; return Math.round(m); }).catch(() => -1)));
  await installLag();
  const cdp = await Promise.all(lanes.map((lane) => lane.page.context().newCDPSession(lane.page)));
  await new Promise((r) => setTimeout(r, 10_000));
  const lagBehind: Record<string, Record<'old' | 'new', number[]>> = {};
  for (const phase of ['quiet', 'storm'] as const) {
    lagBehind[phase] = { old: [], new: [] };
    let running = phase === 'storm';
    let sent = 0;
    const storm = (async () => {
      while (running) {
        const tick = Date.now();
        await Promise.all(Array.from({ length: rate }, () => rng.pick(mine)).map((e) => queueNotify(stack, queue, e, [user.macroUserId], sender(seeded.world, e), rng, { waitMs: 1 }).then(() => (sent += 1), () => undefined)));
        await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - tick))));
      }
    })();
    await takeLag();
    for (let round = 0; round < (phase === 'quiet' ? quietRounds : rounds); round++) {
      if (phase === 'storm' && round === from) {
        for (const s of cdp) {
          await s.send('Profiler.enable');
          await s.send('Profiler.setSamplingInterval', { interval: 1000 });
          await s.send('Profiler.start');
        }
      }
      const tracked = Array.from({ length: track }, () => rng.pick(docs));
      for (const e of tracked) await queueNotify(stack, queue, e, [user.macroUserId], sender(seeded.world, e), rng, { waitMs: 1 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 12_000));
      const reads = await Promise.all(
        lanes.map(async (lane) => {
          const rows = new Map<string, string | undefined>();
          for (const tab of ['signal', 'noise'] as const) {
            const r = await probeRead(lane, user.macroUserId, spec(tab)).catch(() => ({ entities: [] }));
            for (const entity of r.entities as { id: string; notifiedAt?: string }[]) rows.set(entity.id, entity.notifiedAt);
          }
          return rows;
        })
      );
      const lag = await takeLag();
      const behind: (number | null)[][] = [[], []];
      for (const e of new Set(tracked)) {
        const truth = await latest(e.id);
        if (!truth) continue;
        reads.forEach((rows, side) => {
          const v = rows.get(e.id);
          behind[side].push(v ? Math.max(0, (Date.parse(`${truth}Z`) - Date.parse(v)) / 1000) : null);
        });
      }
      behind.forEach((b, side) => lagBehind[phase][side ? 'new' : 'old'].push(...b.filter((x): x is number => x !== null)));
      const fmt = (b: (number | null)[]) => b.map((x) => (x === null ? '-' : x.toFixed(0))).join(',');
      console.log(`${at()} ${phase} round ${round} sent=${sent} stall-ms old=${lag[0]} new=${lag[1]} ws-frames old=${frames.old} new=${frames.new} stamp-behind-s old=[${fmt(behind[0])}] new=[${fmt(behind[1])}]`);
      if (phase === 'storm' && round === to) {
        for (const [i, s] of cdp.entries()) {
          const { profile } = (await s.send('Profiler.stop')) as { profile: Profile };
          const side = lanes[i].side;
          writeFileSync(join(out, `${side}.cpuprofile`), JSON.stringify(profile));
          const sum = summarize(profile);
          console.log(`\n== ${side}: profiled ${(sum.total / 1000).toFixed(1)} s, busy ${(sum.busy / 1000).toFixed(1)} s\n-- self\n${sum.self.join('\n')}\n-- time under app functions\n${sum.incl.join('\n')}\n`);
        }
      }
    }
    running = false;
    await storm;
  }
  const max = (a: number[]) => (a.length ? Math.max(...a).toFixed(0) : '-');
  const mean = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(lagBehind).map(([p, s]) => [p, { old: { mean: mean(s.old), max: max(s.old) }, new: { mean: mean(s.new), max: max(s.new) } }]))));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
