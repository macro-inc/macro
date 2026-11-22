// What the channel directory costs while channel events arrive, on a warm
// cache: loads the app as one seeded person twice (cold, then warm), then
// records long tasks and channel_directory.* spans for a quiet window and for
// a window in which another seeded person posts a message a second into
// channels the two share.
//
// Run (inside `nix develop`, from the worktree):
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node ~/.cache/gql-channel-directory/events-cost.mjs \
//     <out-dir> <viewer-session.json> <poster-session.json> <channel-ids.txt>
// Env: BASE, MESSAGES (default 60), QUIET_MS (default 30000),
//      SETTLE_MS (default 30000), COLD_WAIT_MS (default 300000).
import fs from 'node:fs';
import path from 'node:path';

const [outArg, viewerArg, posterArg, channelsArg] = process.argv.slice(2);
if (!outArg || !viewerArg || !posterArg || !channelsArg) {
  console.error('usage: events-cost.mjs <out-dir> <viewer.json> <poster.json> <channel-ids.txt>');
  process.exit(2);
}
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const BASE = (process.env.BASE ?? 'https://localhost:29509').replace(/\/$/, '');
const MESSAGES = Number(process.env.MESSAGES ?? 60);
const QUIET_MS = Number(process.env.QUIET_MS ?? 30_000);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 30_000);
const COLD_WAIT_MS = Number(process.env.COLD_WAIT_MS ?? 300_000);
const viewer = JSON.parse(fs.readFileSync(viewerArg, 'utf8'));
const poster = JSON.parse(fs.readFileSync(posterArg, 'utf8'));
const channelIds = fs.readFileSync(channelsArg, 'utf8').split('\n').filter(Boolean);
const { chromium } = await import(path.resolve('node_modules/playwright/index.mjs'));

const origin = new URL(BASE).origin;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const spans = [];
let laneDone = false;
const laneCursors = new Set();
const EXCLUDED = '00000000-0000-0000-0000-000000000000';

function attributes(list) {
  const out = {};
  for (const { key, value } of list ?? [])
    out[key] =
      value.stringValue ??
      (value.intValue !== undefined ? Number(value.intValue) : undefined) ??
      value.doubleValue ??
      value.boolValue;
  return out;
}
function recordSpans(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  for (const resource of parsed.resourceSpans ?? [])
    for (const scope of resource.scopeSpans ?? [])
      for (const span of scope.spans ?? []) {
        if (!span.name.startsWith('channel_directory.')) continue;
        const start = Number(BigInt(span.startTimeUnixNano) / 1_000_000n);
        const end = Number(BigInt(span.endTimeUnixNano) / 1_000_000n);
        const attrs = attributes(span.attributes);
        spans.push({
          name: span.name,
          startAt: start,
          durationMs: end - start,
          records: attrs['channel_directory.records'],
          keys: attrs['channel_directory.keys'],
          complete: attrs['channel_directory.complete'],
        });
      }
}
function operationName(body) {
  return body?.match(/"operationName"\s*:\s*"([^"]+)"/)?.[1] ?? null;
}
function isChannelLane(body) {
  const compact = (body ?? '').replace(/\s/g, '');
  return (
    compact.includes(`{"id":"${EXCLUDED}"}`) &&
    compact.includes(`{"chatId":"${EXCLUDED}"}`) &&
    !compact.includes(`{"channelId":"${EXCLUDED}"}`)
  );
}

const browser = await chromium.launch({
  channel: 'chromium',
  args: [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
});
await context.addCookies(
  viewer.cookies.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE, httpOnly: true, secure: true };
  })
);
await context.addInitScript(() => {
  try {
    localStorage.setItem('macro:login', 'true');
  } catch {}
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__longTasks.push({ at: performance.timeOrigin + entry.startTime, ms: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
});
await context.route(
  (url) => url.toString().startsWith(`${origin}/`),
  async (route) => {
    const request = route.request();
    const body = request.postData();
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const operation = operationName(body);
      if (operation === 'SoupBackfill' || operation === 'SoupChannelDirectoryBackfill') {
        const cursor = (() => {
          try {
            return JSON.parse(body)?.variables?.input?.continuation?.cursor ?? null;
          } catch {
            return null;
          }
        })();
        const lane = cursor ? laneCursors.has(cursor) : isChannelLane(body);
        if (lane && !(body ?? '').includes('isParticipant":false')) {
          let next = null;
          try {
            next = JSON.parse((await response.body()).toString('utf8'))?.data?.user?.soup?.nextCursor ?? null;
          } catch {}
          if (next) laneCursors.add(next);
          else laneDone = true;
        }
      }
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    }
  }
);
await context.route(
  (url) => url.toString().startsWith(`${origin}/i/otlp/`),
  async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    const pathname = new URL(request.url()).pathname.replace(/^\/i\/otlp/, '');
    if (pathname === '/v1/traces') recordSpans(body);
    try {
      const response = await fetch(`http://localhost:4318${pathname}`, {
        method: 'POST',
        headers: { 'content-type': request.headers()['content-type'] ?? 'application/json' },
        body,
      });
      await route.fulfill({ status: response.status, body: await response.text() });
    } catch {
      await route.fulfill({ status: 200, body: '{}' });
    }
  }
);

const page = await context.newPage();
const coldStart = Date.now();
await page.goto(`${BASE}/app/`, { waitUntil: 'load', timeout: 120_000 });
while (!laneDone && Date.now() - coldStart < COLD_WAIT_MS) await sleep(1_000);
const coldLaneMs = Date.now() - coldStart;
await sleep(10_000);
await page.reload({ waitUntil: 'load', timeout: 120_000 });
await sleep(SETTLE_MS);

async function windowOf(name, run) {
  const startAt = Date.now();
  const posted = await run();
  await sleep(10_000);
  const endAt = Date.now();
  const longTasks = (await page.evaluate(() => window.__longTasks)).filter(
    (task) => task.at >= startAt && task.at < endAt
  );
  const mine = spans.filter((span) => span.startAt >= startAt && span.startAt < endAt);
  const byName = {};
  for (const span of mine) (byName[span.name] ??= []).push(span);
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1), total: sorted.reduce((a, b) => a + b, 0) };
  };
  return {
    name,
    seconds: (endAt - startAt) / 1000,
    posted,
    longTasks: longTasks.length ? stats(longTasks.map((task) => task.ms)) : { n: 0, total: 0 },
    spans: Object.fromEntries(
      Object.entries(byName).map(([key, list]) => [
        key,
        { ...stats(list.map((span) => span.durationMs)), records: Math.max(0, ...list.map((s) => s.records ?? 0)), keys: stats(list.map((s) => s.keys ?? 0)).max },
      ])
    ),
  };
}

const quiet = await windowOf('quiet', async () => {
  await sleep(QUIET_MS);
  return 0;
});
const burst = await windowOf('burst', async () => {
  let posted = 0;
  for (let index = 0; index < MESSAGES; index++) {
    const id = channelIds[index % channelIds.length];
    const sentAt = Date.now();
    const response = await fetch(`${BASE}/dss/messages/channel/${id}`, {
      method: 'POST',
      headers: { cookie: poster.cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ content: `directory cost probe ${index}`, mentions: [], thread_id: null, attachments: [], nonce: `cost-${Date.now()}-${index}` }),
    });
    if (response.ok) posted += 1;
    await sleep(Math.max(0, 1_000 - (Date.now() - sentAt)));
  }
  return posted;
});
await page.screenshot({ path: path.join(outDir, 'end.png') });
const result = { base: BASE, semver: await (await fetch(`${BASE}/app/semver.txt`)).text(), coldLaneMs, windows: [quiet, burst] };
fs.writeFileSync(path.join(outDir, 'events-cost.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();
