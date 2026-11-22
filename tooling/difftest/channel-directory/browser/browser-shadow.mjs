// Loads the app as one seeded person on the local stack and records what the
// channel directory does: every REST channel list page, every channel lane
// page, and the channel_directory.* spans the browser exports.
//
// Run (inside `nix develop`, from the worktree):
//   node ~/.cache/gql-channel-directory/browser-shadow.mjs <out-dir> <session.json> [loads]
// Env: BASE (default https://localhost:29509), WAIT_MS (default 480000),
//      VIDEO=1 records the first load, BETWEEN=<script> runs between loads.
//      UNTIL=quiet stops a load once no channel list, activity or GraphQL
//      request has started or ended for QUIET_MS (default 20000);
//      NO_CACHE=1 runs without the device cache (no SharedWorker), as the
//      differential's N pages do.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [outArg, sessionArg, loadsArg] = process.argv.slice(2);
if (!outArg || !sessionArg) {
  console.error('usage: browser-shadow.mjs <out-dir> <session.json> [loads]');
  process.exit(2);
}
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const BASE = (process.env.BASE ?? 'https://localhost:29509').replace(/\/$/, '');
const WAIT_MS = Number(process.env.WAIT_MS ?? 480_000);
const LOADS = Number(loadsArg ?? 1);
const session = JSON.parse(fs.readFileSync(sessionArg, 'utf8'));
const { chromium } = await import(
  path.resolve('node_modules/playwright/index.mjs')
);

const origin = new URL(BASE).origin;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let load = 0;
let loadStartedAt = 0;
const requests = [];
const spans = [];
const failures = [];
// Cursors the channel lane's pages returned; a continuation page that sends
// one of them belongs to the lane.
const laneCursors = new Set();
const laneDone = new Set();
const UNTIL = process.env.UNTIL ?? 'shadow';
function continuationCursor(body) {
  try {
    return JSON.parse(body)?.variables?.input?.continuation?.cursor ?? null;
  } catch {
    return null;
  }
}

function attributes(list) {
  const out = {};
  for (const { key, value } of list ?? []) {
    out[key] =
      value.stringValue ??
      (value.intValue !== undefined ? Number(value.intValue) : undefined) ??
      value.doubleValue ??
      value.boolValue;
  }
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
        spans.push({
          load,
          name: span.name,
          traceId: span.traceId,
          startMs: start - loadStartedAt,
          durationMs: end - start,
          status: span.status?.code ?? 0,
          attributes: attributes(span.attributes),
        });
      }
}

const EXCLUDED = "00000000-0000-0000-0000-000000000000";
// The channel lane excludes every other entity type and filters no channel out;
// main sends it as SoupBackfill, which the core lanes share.
function isChannelLane(body) {
  if (!body) return false;
  const compact = body.replace(/\s/g, "");
  return (
    compact.includes(`{"id":"${EXCLUDED}"}`) &&
    compact.includes(`{"chatId":"${EXCLUDED}"}`) &&
    !compact.includes(`{"channelId":"${EXCLUDED}"}`)
  );
}

function operationName(body) {
  const match = body?.match(/"operationName"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
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
  ...(process.env.VIDEO
    ? {
        recordVideo: {
          dir: path.join(outDir, 'video'),
          size: { width: 1440, height: 900 },
        },
      }
    : {}),
});
await context.addCookies(
  session.cookies.split('; ').map((pair) => {
    const at = pair.indexOf('=');
    return {
      name: pair.slice(0, at),
      value: pair.slice(at + 1),
      url: BASE,
      httpOnly: true,
      secure: true,
    };
  })
);
await context.addInitScript((noCache) => {
  try {
    localStorage.setItem('macro:login', 'true');
  } catch {}
  if (noCache) {
    try {
      delete window.SharedWorker;
      Object.defineProperty(window, 'SharedWorker', { value: undefined, configurable: true });
    } catch {}
  }
}, !!process.env.NO_CACHE);
let lastTrackedAt = Date.now();

// Every same-origin request goes through Playwright's own client, which
// avoids ERR_NETWORK_CHANGED on this machine and gives the response size.
await context.route(
  (url) => url.toString().startsWith(`${origin}/`),
  async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData();
    const startedAt = Date.now();
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const buffer = await response.body();
      const bytes = buffer.length;
      const operation = operationName(body);
      let channelLane = false;
      if (operation === 'SoupBackfill' || operation === 'SoupChannelDirectoryBackfill') {
        const cursor = continuationCursor(body);
        channelLane = cursor ? laneCursors.has(cursor) : isChannelLane(body);
        const byIdRead = (body ?? '').includes('isParticipant\":false');
        if (channelLane && !byIdRead) {
          let next = null;
          try {
            next = JSON.parse(buffer.toString('utf8'))?.data?.user?.soup?.nextCursor ?? null;
          } catch {}
          if (next) laneCursors.add(next);
          else laneDone.add(load);
        }
      }
      const tracked =
        url.pathname.startsWith('/dss/comms/channels') ||
        url.pathname.startsWith('/dss/channels/activity') ||
        url.pathname.endsWith('/graphql');
      if (tracked) lastTrackedAt = Date.now();
      if (tracked)
        requests.push({
          load,
          method: request.method(),
          path: url.pathname,
          query: url.search,
          operation,
          channelLane,
          byId: (body ?? "").includes("isParticipant\":false"),
          status: response.status(),
          bytes,
          startMs: startedAt - loadStartedAt,
          endMs: Date.now() - loadStartedAt,
        });
      if (response.status() >= 500)
        failures.push({ load, status: response.status(), path: url.pathname });
      await route.fulfill({ response });
    } catch (error) {
      failures.push({ load, error: String(error), path: url.pathname });
      await route.abort().catch(() => {});
    }
  }
);
// Registered last, so it runs first: browser spans go to the local collector
// and into this run's record.
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
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error')
    consoleErrors.push({ load, text: message.text().slice(0, 300) });
});

const summaries = [];
for (load = 1; load <= LOADS; load++) {
  if (load > 1 && process.env.BETWEEN) {
    execFileSync('bash', ['-c', process.env.BETWEEN], { stdio: 'inherit' });
  }
  loadStartedAt = Date.now();
  lastTrackedAt = Date.now();
  if (load === 1) await page.goto(`${BASE}${process.env.START_PATH ?? "/app/"}`, { waitUntil: "load", timeout: 120_000 });
  else await page.reload({ waitUntil: 'load', timeout: 120_000 });
  const deadline = Date.now() + WAIT_MS;
  let lastShotAt = 0;
  while (Date.now() < deadline) {
    if (UNTIL === 'lane' && laneDone.has(load)) break;
    if (UNTIL === 'quiet' && Date.now() - loadStartedAt > 15_000 && Date.now() - lastTrackedAt > Number(process.env.QUIET_MS ?? 20_000)) break;
    if (process.env.SHOTS_EVERY && Date.now() - lastShotAt >= Number(process.env.SHOTS_EVERY)) {
      lastShotAt = Date.now();
      await page.screenshot({ path: path.join(outDir, `load-${load}-t${String(Math.round((lastShotAt - loadStartedAt) / 1000)).padStart(3, '0')}.png`) });
    }
    if (spans.some((span) => span.load === load && span.name === 'channel_directory.shadow'))
      break;
    await sleep(1_000);
  }
  // Let the batch exporter flush the spans that end with the shadow.
  await sleep(6_000);
  await page.screenshot({ path: path.join(outDir, `load-${load}.png`) });
  const mine = requests.filter((request) => request.load === load);
  const rest = mine.filter((request) => request.path.startsWith('/dss/comms/channels'));
  const activity = mine.filter((request) => request.path.startsWith('/dss/channels/activity'));
  const lane = mine.filter((request) => request.channelLane && !request.byId);
  const byId = mine.filter((request) => request.channelLane && request.byId);
  const sum = (list) => list.reduce((total, request) => total + request.bytes, 0);
  const window = (list) =>
    list.length ? { firstStartMs: Math.min(...list.map((r) => r.startMs)), lastEndMs: Math.max(...list.map((r) => r.endMs)) } : null;
  const operations = {};
  for (const request of mine) {
    const key = request.operation ?? `${request.method} ${request.path}`;
    operations[key] = (operations[key] ?? 0) + 1;
  }
  summaries.push({
    load,
    url: page.url().replace(origin, ''),
    rest: { requests: rest.length, bytes: sum(rest), statuses: [...new Set(rest.map((r) => r.status))], ...window(rest) },
    activity: { requests: activity.length, methods: [...new Set(activity.map((r) => r.method))] },
    lane: { requests: lane.length, bytes: sum(lane), ...window(lane) },
    byId: { requests: byId.length, bytes: sum(byId) },
    operations,
    spans: spans.filter((span) => span.load === load),
  });
  console.log(JSON.stringify(summaries.at(-1)));
}

await context.close();
await browser.close();
fs.writeFileSync(
  path.join(outDir, 'run.json'),
  JSON.stringify({ base: BASE, summaries, requests, failures, consoleErrors: consoleErrors.slice(0, 50) }, null, 2)
);
console.log(`wrote ${path.join(outDir, 'run.json')}`);
