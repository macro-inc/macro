// Shared helpers for the channel open-path measurements.
// Run with node from the repo root inside `nix develop` (or any node >= 20):
//   node ~/.cache/channels-perf/<script>.cjs
const path = require('node:path');
const fs = require('node:fs');

const HERE = __dirname;
const REPO = '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync';
const pw = require(path.join(REPO, 'node_modules/playwright'));
const ENV = JSON.parse(fs.readFileSync(path.join(HERE, 'env.json'), 'utf8'));
const BASE = ENV.base; // https://localhost:<proxy>
const OUT = path.join(HERE, 'results');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const r = (x) => Math.round(x * 10) / 10;
  return { n: v.length, min: r(v[0]), median: r(quantile(v, 0.5)), p90: r(quantile(v, 0.9)), max: r(v[v.length - 1]) };
}

async function launch() {
  // Chrome refuses to use its HTTP disk cache over connections with certificate errors, so
  // ignoreHTTPSErrors alone makes every load re-download the bundle. Whitelisting the stack's
  // certificate keys (ca/spki.txt: leaf + "Macro Local CA") makes the connection valid and the cache usable.
  // CHANNELS_PERF_UNTRUSTED=1 restores the old behaviour (no HTTP cache).
  const trusted = !process.env.CHANNELS_PERF_UNTRUSTED;
  const spki = fs.readFileSync(path.join(HERE, 'ca/spki.txt'), 'utf8').split('\n').filter((l) => /=$/.test(l.trim())).map((l) => l.trim());
  return pw.chromium.launch({
    headless: true, channel: process.env.CHANNELS_PERF_CHANNEL || undefined,
    args: [...(trusted ? [`--ignore-certificate-errors-spki-list=${spki.join(',')}`] : []), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
}

// Log a persona in once and keep only its cookies (no localStorage / IndexedDB), so
// later contexts start with auth but with every client cache cold.
const authCache = new Map();
async function authState(browser, email) {
  if (authCache.has(email)) return authCache.get(email);
  const file = path.join(HERE, 'tmp', `auth-${email.split('@')[0]}.json`);
  const context = await browser.newContext({ ignoreHTTPSErrors: !!process.env.CHANNELS_PERF_UNTRUSTED, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email);
  const state = await context.storageState();
  const cookiesOnly = { cookies: state.cookies, origins: [] };
  fs.writeFileSync(file, JSON.stringify(cookiesOnly));
  await context.close();
  authCache.set(email, cookiesOnly);
  return cookiesOnly;
}

async function login(page, email) {
  await page.goto(`${BASE}/app/login?email=${encodeURIComponent(email)}`);
  await page.waitForURL((u) => !/\/(login|welcome)/.test(u.pathname), { timeout: 120_000 });
  for (const name of ['Get started', 'Continue', 'Skip for now', 'Continue with Free']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click();
      await page.waitForTimeout(1000);
    }
  }
}

// insecure: needed when the context's node-side `request` API is used (it does not see the browser's SPKI whitelist).
async function newContext(browser, { storageState, insecure } = {}) {
  return browser.newContext({ ignoreHTTPSErrors: !!insecure || !!process.env.CHANNELS_PERF_UNTRUSTED, viewport: { width: 1440, height: 900 }, storageState });
}

const THROTTLE = { offline: false, latency: 150, downloadThroughput: (10 * 1000 * 1000) / 8, uploadThroughput: (10 * 1000 * 1000) / 8 };

// Probe injected before any page script. It answers "when did the first target message
// get into the DOM, visible", "when was the next frame after that" and "when did the
// timeline settle at the bottom", all on the page's performance.now() clock.
const PROBE = `(() => {
  if (window.__probe) return;
  const P = (window.__probe = { longTasks: [], marks: {} });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  P.visible = visible;
  // Arm a watch. opts: { ids: string[] (target channel message ids), lastId, targetId, settleMs }
  P.arm = (opts) => {
    const W = (P.watch = { armedAt: performance.now(), opts, firstDom: null, firstPaint: null, lastSeen: null,
      settled: null, target: null, targetHighlighted: null, samples: [] });
    const ids = new Set(opts.ids || []);
    const sel = '[data-message-id]';
    let stableSince = null; let lastSig = '';
    const check = () => {
      const now = performance.now();
      const nodes = document.querySelectorAll(sel);
      if (W.firstDom === null) {
        for (const n of nodes) {
          const id = n.getAttribute('data-message-id');
          if ((ids.size === 0 || ids.has(id)) && visible(n)) {
            W.firstDom = now; W.firstId = id;
            requestAnimationFrame(() => requestAnimationFrame(() => { W.firstPaint = performance.now(); }));
            break;
          }
        }
      }
      if (opts.targetId && W.target === null) {
        const t = document.querySelector('[data-message-id="' + opts.targetId + '"]');
        if (t && t.hasAttribute('data-targeted') && W.targetHighlighted === null) W.targetHighlighted = now;
        if (t && visible(t)) { W.target = now; W.targetClass = t.className && String(t.className).slice(0, 400);
          W.targetAttrs = Array.from(t.attributes).map((a) => a.name + '=' + String(a.value).slice(0, 60)).join(' ').slice(0, 600); }
      }
      if (opts.targetId && W.targetHighlighted === null) {
        const t = document.querySelector('[data-message-id="' + opts.targetId + '"][data-targeted]');
        if (t && visible(t)) W.targetHighlighted = now;
      }
      if (opts.lastId && W.firstDom !== null && W.settled === null) {
        const last = document.querySelector('[data-message-id="' + opts.lastId + '"]');
        const sig = nodes.length + ':' + (last ? Math.round(last.getBoundingClientRect().bottom) : 'x') + ':' + document.documentElement.scrollHeight;
        if (last && visible(last)) {
          if (W.lastSeen === null) W.lastSeen = now;
          if (sig !== lastSig) { stableSince = now; lastSig = sig; }
          else if (stableSince !== null && now - stableSince >= (opts.settleMs || 500)) { W.settled = stableSince; W.domCount = nodes.length; }
        } else { stableSince = null; lastSig = sig; }
      }
    };
    W.check = check;
    const mo = new MutationObserver(check);
    mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-message-id', 'data-targeted'] });
    const loop = () => { check(); if (!W.stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const iv = setInterval(() => { check(); if (W.stop) { clearInterval(iv); mo.disconnect(); } }, 16);
    return true;
  };
  P.snapshot = () => {
    const W = P.watch || {};
    const nodes = document.querySelectorAll('[data-message-id]');
    let vis = 0; for (const n of nodes) if (visible(n)) vis++;
    return { timeOrigin: performance.timeOrigin, now: performance.now(), armedAt: W.armedAt, firstDom: W.firstDom, firstPaint: W.firstPaint,
      firstId: W.firstId, lastSeen: W.lastSeen, settled: W.settled, target: W.target, targetHighlighted: W.targetHighlighted, targetClass: W.targetClass, targetAttrs: W.targetAttrs,
      domMessages: nodes.length, visibleMessages: vis, domNodes: document.getElementsByTagName('*').length,
      longTasks: P.longTasks.slice(), clickAt: P.clickAt || null, url: location.href };
  };
  // Stamp the first trusted pointerdown/click after armClick().
  P.armClick = () => { P.clickAt = null; const h = (e) => { if (P.clickAt === null) P.clickAt = performance.now(); };
    window.addEventListener('pointerdown', h, { capture: true, once: true }); window.addEventListener('click', h, { capture: true, once: true }); };
})();`;

// Network + WebSocket recorder over CDP. All times are wall-clock ms (epoch).
async function recorder(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const reqs = new Map();
  const ws = new Map();
  const frames = [];
  let skew = null; // wallTime - monotonic, seconds
  const wall = (ts) => (skew === null ? null : (ts + skew) * 1000);
  cdp.on('Network.requestWillBeSent', (e) => {
    if (skew === null) skew = e.wallTime - e.timestamp;
    // Redirects reuse the requestId; keep the latest hop.
    reqs.set(e.requestId, { id: e.requestId, url: e.request.url, method: e.request.method, type: e.type,
      start: e.wallTime * 1000, postData: e.request.postData ? e.request.postData.slice(0, 4000) : undefined,
      initiator: e.initiator && e.initiator.type });
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId); if (!r) return;
    r.status = e.response.status; r.mime = e.response.mimeType; r.fromDiskCache = !!e.response.fromDiskCache;
    r.fromServiceWorker = !!e.response.fromServiceWorker; r.protocol = e.response.protocol;
    const t = e.response.timing;
    // responseReceived.timestamp is when the renderer saw the response; the network-level header time is in `timing`.
    r.headersAt = t && t.receiveHeadersEnd >= 0 ? wall(t.requestTime + t.receiveHeadersEnd / 1000) : wall(e.timestamp);
    if (t) r.timing = { dns: t.dnsEnd - t.dnsStart, connect: t.connectEnd - t.connectStart, ssl: t.sslEnd - t.sslStart,
      sendToHeaders: t.receiveHeadersEnd - t.sendEnd, requestTime: t.requestTime };
    const st = e.response.headers && (e.response.headers['server-timing'] || e.response.headers['Server-Timing']);
    if (st) r.serverTiming = st;
    const tp = e.response.headers && (e.response.headers['traceparent'] || e.response.headers['x-trace-id']);
    if (tp) r.traceHeader = tp;
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const r = reqs.get(e.requestId); const tp = e.headers && (e.headers['traceparent'] || e.headers['Traceparent']);
    if (tp) { if (r) r.traceparent = tp; else pendingTp.set(e.requestId, tp); }
  });
  const pendingTp = new Map();
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId); if (!r) return;
    r.end = wall(e.timestamp); r.bytes = e.encodedDataLength;
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId); if (!r) return;
    r.end = wall(e.timestamp); r.failed = e.errorText; r.canceled = e.canceled;
  });
  cdp.on('Network.webSocketCreated', (e) => { ws.set(e.requestId, { id: e.requestId, url: e.url, created: Date.now() }); });
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => { const w = ws.get(e.requestId); if (w) { w.open = wall(e.timestamp) ?? Date.now(); w.status = e.response.status; } });
  cdp.on('Network.webSocketClosed', (e) => { const w = ws.get(e.requestId); if (w) w.closed = wall(e.timestamp) ?? Date.now(); });
  const frame = (dir) => (e) => {
    const w = ws.get(e.requestId);
    const p = e.response.payloadData || '';
    frames.push({ ws: w ? w.url : e.requestId, dir, at: wall(e.timestamp) ?? Date.now(), bytes: p.length, opcode: e.response.opcode, preview: p.slice(0, 600) });
  };
  cdp.on('Network.webSocketFrameReceived', frame('recv'));
  cdp.on('Network.webSocketFrameSent', frame('sent'));
  const metrics = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { Timestamp: m.Timestamp, TaskDuration: m.TaskDuration, ScriptDuration: m.ScriptDuration, LayoutDuration: m.LayoutDuration,
      RecalcStyleDuration: m.RecalcStyleDuration, LayoutCount: m.LayoutCount, RecalcStyleCount: m.RecalcStyleCount,
      JSHeapUsedSize: m.JSHeapUsedSize, Nodes: m.Nodes, Documents: m.Documents };
  };
  return {
    cdp, metrics,
    mark: () => ({ reqIds: new Set(reqs.keys()), frameCount: frames.length }),
    requests: () => {
      for (const [id, tp] of pendingTp) { const r = reqs.get(id); if (r && !r.traceparent) r.traceparent = tp; }
      return Array.from(reqs.values());
    },
    frames: () => frames.slice(), sockets: () => Array.from(ws.values()),
    throttle: (on) => cdp.send('Network.emulateNetworkConditions', on ? THROTTLE : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    offline: (on) => cdp.send('Network.emulateNetworkConditions', on ? { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
  };
}

function metricDelta(a, b) {
  const ms = (k) => Math.round((b[k] - a[k]) * 1000 * 10) / 10;
  return { taskMs: ms('TaskDuration'), scriptMs: ms('ScriptDuration'), layoutMs: ms('LayoutDuration'), recalcStyleMs: ms('RecalcStyleDuration'),
    layouts: b.LayoutCount - a.LayoutCount, heapMB: Math.round((b.JSHeapUsedSize / 1048576) * 10) / 10, nodes: b.Nodes };
}

const isStatic = (u) => /\.(js|css|woff2?|ttf|png|svg|jpg|jpeg|webp|ico|wasm|map|json|webmanifest)(\?|$)/.test(u) && !/\/(dss|comms|auth|contacts|notification|search|email|cognition|static-file|sfs|i)\//.test(new URL(u).pathname);

// Build an ordered waterfall relative to t0 (wall ms). firstPaintWall marks "blocked first paint":
// the request started before the first message was painted (finished-before is recorded separately).
function waterfall(reqs, t0, firstPaintWall, { includeStatic = false } = {}) {
  return reqs
    .filter((r) => r.start >= t0 - 1)
    .filter((r) => includeStatic || !isStatic(r.url))
    .filter((r) => !r.url.startsWith('data:') && !r.url.startsWith('blob:'))
    .sort((a, b) => a.start - b.start)
    .map((r) => {
      const u = new URL(r.url);
      let op;
      if (r.postData && /graphql/.test(u.pathname)) {
        try { const b = JSON.parse(r.postData); op = b.operationName || (b.query || '').match(/(query|mutation|subscription)\s+(\w+)/)?.[2]; } catch (e) { op = (r.postData.match(/(query|mutation)\s+(\w+)/) || [])[2]; }
      }
      return {
        method: r.method, path: u.pathname + (u.search.length > 160 ? u.search.slice(0, 160) + '…' : u.search), op, type: r.type, status: r.status ?? (r.failed ? `ERR ${r.failed}` : 'pending'),
        startMs: Math.round(r.start - t0), ttfbMs: r.headersAt ? Math.round(r.headersAt - r.start) : null,
        durationMs: r.end ? Math.round(r.end - r.start) : null, bytes: r.bytes ?? null, cache: r.fromDiskCache || undefined,
        startedBeforeFirstPaint: firstPaintWall ? r.start < firstPaintWall : null,
        finishedBeforeFirstPaint: firstPaintWall && r.end ? r.end <= firstPaintWall : false,
        traceparent: r.traceparent, postData: r.postData && r.postData.length < 1500 ? r.postData : r.postData ? r.postData.slice(0, 1500) + '…' : undefined,
      };
    });
}

function staticSummary(reqs, t0) {
  const s = reqs.filter((r) => r.start >= t0 - 1 && isStatic(r.url));
  return { count: s.length, bytes: s.reduce((a, r) => a + (r.bytes || 0), 0), fromDiskCache: s.filter((r) => r.fromDiskCache).length,
    lastEndMs: s.length ? Math.round(Math.max(...s.map((r) => r.end || r.start)) - t0) : null };
}

async function waitFor(fn, { timeout = 60_000, interval = 50 } = {}) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > timeout) return null;
    await sleep(interval);
  }
}

module.exports = { pw, ENV, BASE, OUT, HERE, REPO, log, sleep, stats, launch, authState, login, newContext, PROBE, recorder, metricDelta, waterfall, staticSummary, waitFor, THROTTLE, isStatic };
