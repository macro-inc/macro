// Live notification latency, main's Home against the branch's, side by side.
//
// Each side's Home (touch Signal by default; LAT_TOUCH=0 and LAT_TAB=noise
// pick desktop and Noise) stays mounted in its own tab, for the same viewer.
// A trial sends one notification (or a burst of three, 250 ms apart) through
// the notification ingress queue, as the backend's producers do, and times
// how long each tab takes from the send until the notified rows are the top
// rows of its Home grid, in notification order. The websocket frame that
// carries the notification to each tab is timed too, so the client's share of
// the latency is separate from the backend's.
//
// Trial kinds:
//   loaded   the row is in the tab's loaded pages, below the top
//   unloaded the row is in the viewer's Signal list but past the loaded pages
//   burst    three rows notified 250 ms apart; done when the top three are
//            those rows, newest first
//
//   LAT_RUN      out/<LAT_RUN> (default latency-quiet)
//   PROOF_SEED   world seed (new to the instance)
//   LAT_TRIALS   trials (default 120)
//   LAT_LOAD=1   6 notifiers and 2 reader pairs on other viewers meanwhile
//   LAT_PAGES    rows to scroll through first on the multi-page viewer (default 150)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, readHomeDom, startApp, stopApp, type Lane, type ReadSpec } from './lib/browser.ts';
import { queueNotify } from './lib/notify.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld, sender } from './lib/setup.ts';
import { sql, stackFromEnv, type User } from './lib/stack.ts';
import type { Entity, World } from './lib/world.ts';

const env = process.env;
const here = import.meta.dirname;
const runName = env.LAT_RUN ?? 'latency-quiet';
const out = join(here, 'out', runName);
mkdirSync(out, { recursive: true });
const log = (line: string) => {
  const at = new Date().toISOString();
  console.log(`${at} ${line}`);
  appendFileSync(join(out, 'run.log'), `${at} ${line}\n`);
};
const stack = stackFromEnv();
const seed = Number(env.PROOF_SEED ?? 3801);
const trials = Number(env.LAT_TRIALS ?? 120);
const load = env.LAT_LOAD === '1';
const scrollRows = Number(env.LAT_PAGES ?? 150);
// Desktop Signal lists the server work feed on both sides; touch Home (and
// desktop Noise, which lists unimportant emails only) list the notified Soup
// list the branch moves to GraphQL. So the default is touch Signal.
const tab: 'signal' | 'noise' = env.LAT_TAB === 'noise' ? 'noise' : 'signal';
const touch = env.LAT_TOUCH !== '0';
const BOUND_MS = 30_000;
const queueUrl = env.PROOF_QUEUE_URL ?? '';
const portBase = Number(env.PROOF_PORT_BASE ?? 30110);
const viteEnv = { backendProxy: stack.proxyUrl, routes: env.PROOF_ROUTES ?? '', caPem: env.PROOF_CA_PEM ?? '', hostname: env.PROOF_HOSTNAME ?? 'localhost' };

const seeded = await seedWorld(stack, {
  seed,
  lanes: 2,
  sizes: [100, 2000],
  outDir: join(out, 'world'),
  repo: env.PROOF_REPO ?? '',
  instance: stack.instance,
  log,
});
const world = seeded.world;
const userOf = (key: string): User => {
  const user = seeded.users.get(key);
  if (!user) throw new Error(`no user ${key}`);
  return user;
};

// v0 (one page of mixed kinds) and n100 (scrolled through several pages) are
// timed; load, when on, notifies v1 and n2000 and reads n2000.
const timed = ['v0', 'n100'];
const apps = await Promise.all([
  startApp('old', env.PROOF_OLD_WORKTREE ?? '', portBase, viteEnv, join(here, 'probe.ts'), out),
  startApp('new', env.PROOF_NEW_WORKTREE ?? '', portBase + 1, viteEnv, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const stops: (() => Promise<void>)[] = [];
const summary: Record<string, unknown> = { run: runName, seed, trials, load, scrollRows, boundMs: BOUND_MS, tab, touch };

type Watched = { viewer: string; lanes: [Lane, Lane]; entities: Map<string, Entity>; loaded: Set<string>; signal: string[] };
/** Notification ids each tab's websocket delivered, with when. */
const frames: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function watchFrames(lane: Lane, side: 0 | 1) {
  lane.page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const at = Date.now();
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      for (const id of text.match(UUID) ?? []) if (!frames[side].has(id)) frames[side].set(id, at);
    });
  });
}

/** Ids of the Home grid's top entity rows, by position on screen. */
async function waitTop(lane: Lane, ids: string[], deadline: number): Promise<number | null> {
  return lane.page.evaluate(
    async ({ ids, deadline }) => {
      const topIds = () => {
        const grid = document.querySelector('[role="grid"][aria-label="Home"]');
        if (!grid) return [];
        return [...grid.querySelectorAll('[role="row"]')]
          .filter((h) => h.getAttribute('data-soup-entity') !== null || (h.id && !h.id.includes('group-header')))
          .map((h) => ({ top: h.getBoundingClientRect().top, id: h.id || h.getAttribute('data-soup-entity') || '' }))
          .sort((a, b) => a.top - b.top)
          .slice(0, ids.length)
          .map((r) => r.id);
      };
      while (Date.now() < deadline) {
        const top = topIds();
        if (top.length === ids.length && ids.every((id, i) => top[i].includes(id))) return Date.now();
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    },
    { ids, deadline }
  );
}

async function scrollToTop(lane: Lane) {
  await lane.page.evaluate(() => {
    const grid = document.querySelector('[role="grid"][aria-label="Home"]');
    for (let el = grid as HTMLElement | null; el; el = el.parentElement) el.scrollTop = 0;
    grid?.querySelectorAll('*').forEach((el) => ((el as HTMLElement).scrollTop = 0));
  });
}

function startLoad(): () => Promise<void> {
  let running = true;
  const counts = { notifications: 0, reads: 0, errors: 0 };
  const rng = new Rng(seed * 7 + 1);
  const targets = world.entities.filter((e) => e.viewer === 'v1' || e.viewer === 'n2000');
  const notifier = async () => {
    while (running && targets.length) {
      const entity = rng.pick(targets);
      const recipient = world.viewers.find((v) => v.key === entity.viewer)?.userId ?? '';
      await queueNotify(stack, queueUrl, entity, [recipient], sender(world, entity), rng, { waitMs: 5000 }).then(
        () => (counts.notifications += 1),
        () => (counts.errors += 1)
      );
    }
  };
  const reader = async () => {
    const user = userOf('n2000');
    const pair = await Promise.all(apps.map((app) => openLane(browser, app, user)));
    try {
      while (running) {
        const spec: ReadSpec = { source: { kind: 'home', tab: rng.pick(['signal', 'noise'] as const), facets: {}, foreignEntities: true }, fresh: true, maxPages: 20 };
        await Promise.all(pair.map((lane) => probeRead(lane, user.macroUserId, spec))).then(() => (counts.reads += 2), () => (counts.errors += 1));
      }
    } finally {
      await Promise.all(pair.map((lane) => lane.context.close())).catch(() => undefined);
    }
  };
  const tasks = [...Array.from({ length: 6 }, notifier), reader(), reader()];
  log('load: started 6 notifiers and 2 reader pairs');
  return async () => {
    running = false;
    await Promise.allSettled(tasks);
    summary.loadCounts = counts;
    log(`load: ${JSON.stringify(counts)}`);
  };
}

try {
  // Compile each app once before timing anything.
  {
    const warm = await Promise.all(apps.map((app) => openLane(browser, app, userOf('v0'))));
    await Promise.all(warm.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 }).catch(() => undefined)));
    await Promise.all(warm.map((lane) => lane.context.close()));
  }
  const watched: Watched[] = [];
  for (const key of timed) {
    const user = userOf(key);
    const lanes = (await Promise.all(apps.map((app) => openLane(browser, app, user, { tab, touch })))) as [Lane, Lane];
    lanes.forEach((lane, side) => watchFrames(lane, side as 0 | 1));
    await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
    // Settle, then load pages on the multi-page viewer by scrolling.
    await new Promise((r) => setTimeout(r, 3000));
    const dom = await Promise.all(lanes.map((lane) => readHomeDom(lane, key === 'v0' ? 40 : scrollRows)));
    const ids = (rows: typeof dom[0]) => rows.filter((r) => (r as { kind: string }).kind === 'entity').map((r) => (r as { id: string }).id);
    // The row ids are composite (…|s36:<uuid>|…): keep the uuid.
    const uuidOf = (id: string) => id.match(UUID)?.[0] ?? id;
    const loadedOld = new Set(ids(dom[0]).map(uuidOf));
    const loadedNew = new Set(ids(dom[1]).map(uuidOf));
    const loaded = new Set([...loadedOld].filter((id) => loadedNew.has(id)));
    // The whole Signal list, from a fresh read on main's side.
    const fresh = await probeRead(lanes[0], user.macroUserId, { source: { kind: 'home', tab, facets: {}, foreignEntities: true }, fresh: true, allPages: true });
    const signal = fresh.entities.map((e) => String((e as { id: unknown }).id));
    const entities = new Map(world.entities.filter((e) => e.viewer === key && !e.secondary).map((e) => [e.id, e]));
    watched.push({ viewer: key, lanes, entities, loaded, signal });
    log(`viewer ${key}: signal ${signal.length}, loaded old ${loadedOld.size} new ${loadedNew.size} both ${loaded.size}, notifiable ${signal.filter((id) => entities.has(id)).length}`);
    await Promise.all(lanes.map(scrollToTop));
  }
  if (load) stops.push(startLoad());

  const rng = new Rng(seed * 13 + 3);
  const results: Record<string, unknown>[] = [];
  for (let n = 0; n < trials; n++) {
    const w = watched[n % watched.length];
    const notifiable = w.signal.filter((id) => w.entities.has(id));
    const roll = rng.int(0, 99);
    const unloadedPool = notifiable.filter((id) => !w.loaded.has(id));
    const kind = roll < 25 ? 'burst' : roll < 50 && unloadedPool.length ? 'unloaded' : 'loaded';
    const loadedPool = notifiable.filter((id) => w.loaded.has(id));
    const targets =
      kind === 'burst'
        ? rng.shuffle(loadedPool).slice(0, 3)
        : [rng.pick(kind === 'unloaded' ? unloadedPool : loadedPool.slice(1))];
    if (!targets.length || targets.some((t) => !t)) continue;
    await Promise.all(w.lanes.map(scrollToTop));
    const expected = [...targets].reverse();
    const deadline = Date.now() + BOUND_MS;
    const waits = w.lanes.map((lane) => waitTop(lane, expected, deadline));
    const sent: { id: string; at: number }[] = [];
    const t0 = Date.now();
    const sends: Promise<unknown>[] = [];
    for (const [i, target] of targets.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 250));
      const entity = w.entities.get(target)!;
      const at = Date.now();
      sends.push(
        queueNotify(stack, queueUrl, entity, [world.viewers.find((v) => v.key === w.viewer)!.userId], sender(world, entity), rng).then((r) => {
          sent.push({ id: r.notificationId, at });
          return r;
        })
      );
    }
    const lastSent = Date.now();
    const [reached, written] = await Promise.all([Promise.all(waits), Promise.all(sends)]);
    for (const t of targets) w.loaded.add(t);
    // When the backend wrote each notification, and when each tab got it.
    const ids = sent.map((s) => s.id);
    const created = ids.length
      ? await sql<{ id: string; ms: number }>(stack, `SELECT id::text, (extract(epoch from created_at) * 1000)::float8 AS ms FROM notification WHERE id IN (${ids.map((id) => `'${id}'`).join(',')})`)
      : [];
    const lastId = sent.find((s) => s.at === Math.max(...sent.map((x) => x.at)))?.id ?? '';
    const row = {
      n,
      viewer: w.viewer,
      kind,
      targets: targets.length,
      written: (written as { written: boolean }[]).filter((r) => r.written).length,
      // From the last send (a burst's third notification).
      oldMs: reached[0] === null ? null : reached[0] - lastSent,
      newMs: reached[1] === null ? null : reached[1] - lastSent,
      // From the tab's receipt of the last notification over its websocket.
      oldAfterFrameMs: reached[0] !== null && frames[0].has(lastId) ? reached[0] - frames[0].get(lastId)! : null,
      newAfterFrameMs: reached[1] !== null && frames[1].has(lastId) ? reached[1] - frames[1].get(lastId)! : null,
      oldFrameMs: frames[0].has(lastId) ? frames[0].get(lastId)! - lastSent : null,
      newFrameMs: frames[1].has(lastId) ? frames[1].get(lastId)! - lastSent : null,
      writeMs: created.length ? Math.max(...created.map((c) => Number(c.ms))) - lastSent : null,
      sendSpreadMs: lastSent - t0,
    };
    results.push(row);
    appendFileSync(join(out, 'trials.jsonl'), `${JSON.stringify(row)}\n`);
    if (n % 10 === 0) log(`trial ${n}: ${JSON.stringify(row)}`);
    // Past the branch's 2 s re-read interval and 3 s replica-lag re-read, so
    // each trial starts with no read pending on either side.
    await new Promise((r) => setTimeout(r, 4000));
  }

  const pct = (xs: number[], p: number) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const stats = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x !== null);
    return { n: xs.length, missed: xs.length - ok.length, p50: pct(ok, 50), p90: pct(ok, 90), p95: pct(ok, 95), max: ok.length ? Math.max(...ok) : null };
  };
  const groups: Record<string, Record<string, unknown>> = {};
  for (const key of ['all', 'loaded', 'unloaded', 'burst', ...timed.map((v) => `viewer:${v}`)]) {
    const rows = results.filter((r) => key === 'all' || r.kind === key || `viewer:${r.viewer}` === key);
    const both = rows.filter((r) => r.oldMs !== null && r.newMs !== null);
    groups[key] = {
      old: stats(rows.map((r) => r.oldMs as number | null)),
      new: stats(rows.map((r) => r.newMs as number | null)),
      oldAfterFrame: stats(rows.map((r) => r.oldAfterFrameMs as number | null)),
      newAfterFrame: stats(rows.map((r) => r.newAfterFrameMs as number | null)),
      newMinusOld: stats(both.map((r) => (r.newMs as number) - (r.oldMs as number))),
      frame: stats(rows.map((r) => r.newFrameMs as number | null)),
    };
  }
  summary.groups = groups;
  log(`summary: ${JSON.stringify(groups.all)}`);
} finally {
  for (const stop of stops) await stop().catch(() => undefined);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  for (const app of apps) stopApp(app);
}
