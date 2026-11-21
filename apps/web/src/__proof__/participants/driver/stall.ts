// Readers that stay pending after a reload under load. The seed-1 run under
// load saw pages where, after a reload, the head's reader of every channel
// stayed pending for more than the 30 s settle wait while main's had rows (and
// fewer pages the other way round); the quiet run saw none. Here a viewer in
// many channels reloads while another user floods membership writes, either
// on channels the viewer is in (so every write reaches the viewer's socket and
// cache) or on channels it is not in (server load only), or with no load. Each
// round records, per side, when each channel first had data, and for the head
// whether its by-id read (ChannelParticipantsSoup) was sent and answered.
// Usage: bun driver/stall.ts   (PX_REPEATS, PX_CHANNELS, PX_WATCH_MS, PX_ONLY)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import type { Snap } from './compare';
import {
  clearSignUpCounter,
  dss,
  gotoRetrying,
  login,
  ORIGIN,
  px,
  sleep,
} from './stack';

const env = process.env;
const RUN = env.PX_RUN ?? `st${Date.now().toString(36)}`;
const OUT = env.PX_OUT ?? `/tmp/px-${RUN}`;
const REPEATS = Number(env.PX_REPEATS ?? 3);
const CHANNELS = Number(env.PX_CHANNELS ?? 40);
const WATCH_MS = Number(env.PX_WATCH_MS ?? 45_000);
const AFTER_MS = Number(env.PX_AFTER_MS ?? 30_000);
const ONLY = env.PX_ONLY ?? '';
const DOMAIN = `${RUN}.example.com`;
const email = (name: string) => `${name}@${DOMAIN}`;
const userId = (name: string) => `macro|${email(name)}`;

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (line: string) => {
  const text = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`;
  console.log(text);
  appendFileSync(`${OUT}/log.txt`, `${text}\n`);
};

type Variant = { name: string; load: 'viewer' | 'elsewhere' | 'none' };
const VARIANTS: Variant[] = [
  { name: 'no load', load: 'none' },
  { name: 'writes on channels the viewer is in', load: 'viewer' },
  { name: 'writes on channels the viewer is not in', load: 'elsewhere' },
];

async function installOn(page: Page, who: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState('load');
      await px(page, 'install', userId(who));
      return attempt;
    } catch (error) {
      if (attempt >= 8) throw error;
      log(`${who} setup failed, reloading: ${String(error).split('\n')[0]}`);
      await sleep(1000);
      await page.reload({ timeout: 90_000 }).catch(() => undefined);
    }
  }
}

async function startLoad(page: Page, channels: string[], noise: string[]) {
  await page.evaluate(
    ({ channels, noise, origin }) => {
      const w = window as unknown as { __load?: boolean; __loadOps?: number };
      w.__load = true;
      w.__loadOps = 0;
      const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
      const go = (path: string, method: string, body?: unknown) =>
        fetch(`${origin}/dss${path}`, {
          method,
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }).then(
          (r) => r.text(),
          () => ''
        );
      // As run.ts's load: 24 writers, membership writes, renames, REST reads.
      for (let worker = 0; worker < 24; worker++) {
        (async () => {
          while (w.__load) {
            const id = pick(channels);
            const roll = Math.random();
            if (roll < 0.3)
              await go(`/channels/${id}/participants`, 'POST', {
                participants: [pick(noise)],
              });
            else if (roll < 0.55)
              await go(`/channels/${id}/participants`, 'DELETE', {
                participants: [pick(noise)],
              });
            else if (roll < 0.7)
              await go(`/channels/${id}`, 'PATCH', {
                channel_name: `noise ${Math.random()}`,
              });
            else await go(`/channels/${id}/participants`, 'GET');
            w.__loadOps! += 1;
          }
        })().catch(() => undefined);
      }
    },
    { channels, noise, origin: ORIGIN }
  );
}

async function stopLoad(page: Page) {
  return await page.evaluate(() => {
    const w = window as unknown as { __load?: boolean; __loadOps?: number };
    w.__load = false;
    return w.__loadOps ?? 0;
  });
}

type ByIdRequest = { sentAt: number; doneAt?: number; failed?: string };

const pct = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors'],
});
const newContext = () =>
  browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });

try {
  clearSignUpCounter();
  const ownerContext = await newContext();
  const viewerContext = await newContext();
  const loadContext = await newContext();
  const owner = await login(ownerContext, email('owner'), false, log);
  const viewer = await login(viewerContext, email('viewer'), true, log);
  const loader = await login(loadContext, email('load'), false, log);
  const others = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'].map(userId);
  const noise = ['n1', 'n2', 'n3', 'n4', 'n5'].map(userId);

  // The channels the viewer reads.
  const read: string[] = [];
  for (let i = 0; i < CHANNELS; i++) {
    const made = await dss<{ id: string }>(owner, '/channels', 'POST', {
      channel_type: 'private',
      name: `read ${i}`,
      participants: [userId('viewer'), ...others],
    });
    if (made.body?.id) read.push(made.body.id);
  }
  // Noise channels with the viewer in them, and without.
  const noiseWith: string[] = [];
  const noiseWithout: string[] = [];
  for (let i = 0; i < 16; i++) {
    const withViewer = await dss<{ id: string }>(loader, '/channels', 'POST', {
      channel_type: 'private',
      name: `noise ${i}`,
      participants: [userId('viewer'), userId('owner')],
    });
    if (withViewer.body?.id) noiseWith.push(withViewer.body.id);
    const without = await dss<{ id: string }>(loader, '/channels', 'POST', {
      channel_type: 'private',
      name: `noise elsewhere ${i}`,
      participants: [userId('owner')],
    });
    if (without.body?.id) noiseWithout.push(without.body.id);
  }
  log(
    `${read.length} channels to read; noise ${noiseWith.length} with the viewer, ${noiseWithout.length} without`
  );

  // The head's by-id reads, per channel, for the current page load.
  let byId = new Map<string, ByIdRequest[]>();
  let restReads = new Map<string, number>();
  const tracked = new Map<unknown, { channel: string; at: ByIdRequest }>();
  const channelOf = (body: string) => read.find((id) => body.includes(id));
  viewer.on('request', (request) => {
    const url = request.url();
    if (url.includes('/dss/items/soup/graphql')) {
      const body = request.postData() ?? '';
      if (!body.includes('ChannelParticipantsSoup')) return;
      const channel = channelOf(body);
      if (!channel) return;
      const at: ByIdRequest = { sentAt: Date.now() };
      byId.set(channel, [...(byId.get(channel) ?? []), at]);
      tracked.set(request, { channel, at });
    } else if (request.method() === 'GET' && url.includes('/participants')) {
      const channel = read.find((id) => url.includes(id));
      if (channel) restReads.set(channel, (restReads.get(channel) ?? 0) + 1);
    }
  });
  viewer.on('requestfinished', (request) => {
    const entry = tracked.get(request);
    if (entry) entry.at.doneAt = Date.now();
  });
  viewer.on('requestfailed', (request) => {
    const entry = tracked.get(request);
    if (entry) entry.at.failed = request.failure()?.errorText ?? 'unknown';
  });

  const rounds: Record<string, unknown>[] = [];
  for (const variant of VARIANTS.filter((v) => v.name.includes(ONLY)))
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      if (variant.load === 'viewer') await startLoad(loader, noiseWith, noise);
      if (variant.load === 'elsewhere')
        await startLoad(loader, noiseWithout, noise);
      // Let the load build up before the reload, as in a run.
      if (variant.load !== 'none') await sleep(10_000);
      byId = new Map();
      restReads = new Map();
      const reloadAt = Date.now();
      if (viewer.url().includes('/app/'))
        await viewer.reload({ timeout: 90_000 }).catch(() => undefined);
      else await gotoRetrying(viewer, `${ORIGIN}/app/home`);
      const setupReloads = await installOn(viewer, 'viewer');
      await viewer.evaluate(() => {
        const w = window as unknown as { __net?: string[] };
        w.__net = [`onLine ${navigator.onLine} at ${Date.now()}`];
        addEventListener('online', () => w.__net!.push(`online ${Date.now()}`));
        addEventListener('offline', () =>
          w.__net!.push(`offline ${Date.now()}`)
        );
      });
      await px(
        viewer,
        'mount',
        read.map((id) => ({ id, type: 'private' }))
      );
      const start = Date.now();
      const firstData = {
        old: new Map<string, number>(),
        new: new Map<string, number>(),
      };
      const timeline: string[] = [];
      let loadOps = 0;
      let stoppedAt: number | undefined;
      while (Date.now() - start < WATCH_MS + AFTER_MS) {
        const t = Date.now() - start;
        if (stoppedAt === undefined && t >= WATCH_MS) {
          if (variant.load !== 'none') loadOps = await stopLoad(loader);
          stoppedAt = t;
          timeline.push(`${t}: load stopped`);
        }
        const snaps = await px<Record<string, Snap | null>>(
          viewer,
          'snapshot',
          read
        );
        let oldPending = 0;
        let newPending = 0;
        for (const id of read) {
          const snap = snaps[id];
          if (!snap) continue;
          if (snap.old.isPending) oldPending += 1;
          else if (!firstData.old.has(id)) firstData.old.set(id, t);
          if (snap.new.isPending) newPending += 1;
          else if (!firstData.new.has(id)) firstData.new.set(id, t);
        }
        const entry = `pending old ${oldPending} new ${newPending}`;
        if (!timeline.at(-1)?.endsWith(entry)) timeline.push(`${t}: ${entry}`);
        if (stoppedAt !== undefined && !oldPending && !newPending) break;
        await sleep(500);
      }
      if (stoppedAt === undefined && variant.load !== 'none')
        loadOps = await stopLoad(loader);
      // The head's channels still without data when the load stopped.
      const stuck = read.filter(
        (id) => (firstData.new.get(id) ?? Infinity) >= WATCH_MS
      );
      const requests = [...byId.values()].flat();
      const stuckRequests = stuck.flatMap((id) => byId.get(id) ?? []);
      const net = await viewer
        .evaluate(() => (window as unknown as { __net?: string[] }).__net ?? [])
        .catch(() => []);
      const sides = (side: 'old' | 'new') => {
        const times = read.map((id) => firstData[side].get(id) ?? Infinity);
        const loaded = times.filter((t) => t < WATCH_MS);
        return {
          loadedWithinWatch: loaded.length,
          p50: pct(loaded, 0.5),
          p95: pct(loaded, 0.95),
          max: pct(loaded, 1),
          neverDuringLoad: read.length - loaded.length,
          afterLoadStopped: times
            .filter((t) => t >= WATCH_MS && t !== Infinity)
            .map((t) => t - WATCH_MS),
          never: times.filter((t) => t === Infinity).length,
        };
      };
      const round = {
        variant: variant.name,
        repeat,
        reloadToMountMs: start - reloadAt,
        setupReloads,
        loadOps,
        old: sides('old'),
        new: sides('new'),
        byId: {
          channelsAsked: byId.size,
          requests: requests.length,
          answered: requests.filter((r) => r.doneAt).length,
          failed: requests.filter((r) => r.failed).map((r) => r.failed),
          answerMs: {
            p50: pct(
              requests.filter((r) => r.doneAt).map((r) => r.doneAt! - r.sentAt),
              0.5
            ),
            max: pct(
              requests.filter((r) => r.doneAt).map((r) => r.doneAt! - r.sentAt),
              1
            ),
          },
          stuckChannels: stuck.length,
          stuckNeverAsked: stuck.filter((id) => !byId.has(id)).length,
          stuckAskedUnanswered: stuck.filter((id) =>
            (byId.get(id) ?? []).some((r) => !r.doneAt && !r.failed)
          ).length,
          stuckAnswered: stuck.filter((id) =>
            (byId.get(id) ?? []).some((r) => r.doneAt)
          ).length,
          stuckRequests: stuckRequests.length,
        },
        restReads: [...restReads.values()].reduce((a, b) => a + b, 0),
        net,
        timeline,
      };
      rounds.push(round);
      log(JSON.stringify(round));
    }
  writeFileSync(`${OUT}/stall.json`, JSON.stringify({ RUN, rounds }, null, 2));
} finally {
  await browser.close();
}
