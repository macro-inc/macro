// Measures typing in the Share menu's To field (`?share-recipients`) over
// production builds of this fixture. See README.md, "Share recipient typing".
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

// BUILDS: `label=dist` pairs, comma separated. Builds are measured in turn for
// every size and throttle, in alternating order, so a busy machine slows them
// alike.
const builds = (process.env.BUILDS ?? '')
  .split(',')
  .filter(Boolean)
  .map((entry) => {
    const [label, dist] = entry.split('=');
    return { label, dist: path.resolve(dist) };
  });
const out = process.env.OUT;
if (!builds.length || !out)
  throw new Error('Set BUILDS (label=dist,...) and OUT');
const SIZES = (process.env.SIZES ?? '1000,5000,15000').split(',').map(Number);
const THROTTLES = (process.env.THROTTLES ?? '1,4').split(',').map(Number);
const REPS = Number(process.env.REPS ?? 5);
const QUERIES = (process.env.QUERIES ?? 'sarah chen|design|sarah.chen').split(
  '|'
);
const CADENCE_MS = Number(process.env.CADENCE_MS ?? 120);
const PEOPLE = Number(process.env.PEOPLE ?? 5000);
const DMS = Number(process.env.DMS ?? 500);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 60);
const SETTLE_MS = 1500;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
function serve(dist) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const file = path.join(
      dist,
      url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
    );
    if (!file.startsWith(dist) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server))
  );
}

// Each typed character is timed from its keydown's timestamp (so time spent
// queued behind earlier work counts) to the first moment after the frame that
// follows its input event: the next paint. Each list change is logged with
// the rows on screen, so arrival of final results can be timed too.
function instrument() {
  const m = { keys: [], changes: [], frames: [], recording: false };
  window.__share = m;
  const rows = () =>
    [...document.querySelectorAll('[role="option"]')].map((option) => ({
      person: !!option.querySelector('.opacity-50'),
      text: (option.textContent ?? '').slice(0, 48),
    }));
  let pending;
  document.addEventListener(
    'keydown',
    (event) => {
      if (m.recording) pending = { key: event.key, t0: event.timeStamp };
    },
    true
  );
  document.addEventListener(
    'input',
    () => {
      const record = pending;
      pending = undefined;
      if (!record) return;
      record.handled = performance.now();
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          record.painted = performance.now();
          record.rows = rows();
          m.keys.push(record);
        };
        channel.port2.postMessage(0);
      });
    },
    true
  );
  let last = '';
  new MutationObserver(() => {
    if (!m.recording) return;
    const now = rows();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    m.changes.push({ t: performance.now(), rows: now });
  }).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  new PerformanceObserver((list) => {
    if (!m.recording) return;
    for (const entry of list.getEntries())
      m.frames.push({
        start: entry.startTime,
        duration: entry.duration,
        blocking: entry.blockingDuration,
        scripts: (entry.scripts ?? [])
          .map((script) => ({
            duration: script.duration,
            invoker: script.invoker,
            source: script.sourceFunctionName,
          }))
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3),
      });
  }).observe({ type: 'long-animation-frame', buffered: false });
}

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const round = (value) => (value == null ? null : Math.round(value * 10) / 10);

async function measure(browser, port, label, groups, throttle) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(instrument);
  await page.goto(
    `http://127.0.0.1:${port}/?share-recipients&groups=${groups}&people=${PEOPLE}&dms=${DMS}&latency=${LATENCY_MS}`
  );
  const input = page.getByPlaceholder('To: Email or group');
  await input.waitFor({ timeout: 120_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await input.click();
  await page.waitForTimeout(SETTLE_MS);

  const runs = [];
  const profileRun = throttle === Math.max(...THROTTLES);
  for (let rep = 0; rep < REPS; rep++)
    for (const query of QUERIES) {
      const profile = profileRun && rep === 0 && query === QUERIES[0];
      if (profile) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      await page.evaluate(() => {
        const m = window.__share;
        m.keys = [];
        m.changes = [];
        m.frames = [];
        m.recording = true;
      });
      const start = Date.now();
      for (let index = 0; index < query.length; index++) {
        const wait = start + index * CADENCE_MS - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        await page.keyboard.press(query[index] === ' ' ? 'Space' : query[index]);
      }
      await page.waitForTimeout(SETTLE_MS);
      const run = await page.evaluate(() => {
        const m = window.__share;
        m.recording = false;
        return { keys: m.keys, changes: m.changes, frames: m.frames };
      });
      if (profile) {
        const { profile: cpu } = await cdp.send('Profiler.stop');
        fs.writeFileSync(
          `${out}/${label}-groups-${groups}-x${throttle}.cpuprofile`,
          JSON.stringify(cpu)
        );
      }
      const last = run.keys.at(-1);
      const final = run.changes.at(-1);
      // The list is final at the paint after the last keystroke, or at its
      // last change after that keystroke when results land later.
      const lastChange = final && last && final.t >= last.t0 ? final.t : 0;
      const settledAt = last ? Math.max(last.painted, lastChange) : undefined;
      const finalRows = final?.rows ?? last?.rows ?? [];
      runs.push({
        query,
        keys: run.keys.map((key) => ({
          key: key.key,
          toPaint: key.painted - key.t0,
          queued: key.handled - key.t0,
          people: key.rows.filter((row) => row.person).length,
          rows: key.rows.length,
        })),
        settledAfterLastKey:
          settledAt != null && last ? settledAt - last.t0 : null,
        finalRows,
        longFrames: run.frames,
      });
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(SETTLE_MS);
    }
  await context.close();
  if (errors.length) throw new Error(errors.join('\n'));
  fs.writeFileSync(
    `${out}/${label}-groups-${groups}-x${throttle}.json`,
    JSON.stringify({ label, groups, throttle, runs })
  );
  const keys = runs.flatMap((run) => run.keys);
  const toPaint = keys.map((key) => key.toPaint);
  const settled = runs
    .map((run) => run.settledAfterLastKey)
    .filter((value) => value != null);
  return {
    build: label,
    groups,
    throttle,
    keystrokes: keys.length,
    toPaintP50: round(quantile(toPaint, 0.5)),
    toPaintP95: round(quantile(toPaint, 0.95)),
    toPaintMax: round(Math.max(...toPaint)),
    settledP50: round(quantile(settled, 0.5)),
    settledMax: round(Math.max(...settled)),
    // Keystrokes after which the list painted empty although the query ends
    // with results: the rows blinked out while the next read was pending.
    emptyKeys: runs
      .filter((run) => run.finalRows.length > 0)
      .flatMap((run) => run.keys)
      .filter((key) => key.rows === 0).length,
    longFrameMsPerQuery: round(
      runs
        .flatMap((run) => run.longFrames)
        .reduce((sum, frame) => sum + frame.duration, 0) / runs.length
    ),
  };
}

fs.mkdirSync(out, { recursive: true });
const servers = await Promise.all(builds.map((build) => serve(build.dist)));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const summary = [];
try {
  let turn = 0;
  for (const groups of SIZES)
    for (const throttle of THROTTLES) {
      const order = builds.map((build, index) => ({ build, index }));
      if (turn++ % 2) order.reverse();
      for (const { build, index } of order) {
        const row = await measure(
          browser,
          servers[index].address().port,
          build.label,
          groups,
          throttle
        );
        summary.push(row);
        console.log(JSON.stringify(row));
      }
    }
} finally {
  await browser.close();
  for (const server of servers) server.close();
}
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
