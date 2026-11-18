// Measures typing in the Share menu's To field (`?share-recipients`) over
// production builds of this fixture. See README.md, "Share recipient typing".
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, errors } from 'playwright';

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
// The list is final once no contact read is pending and nothing has changed
// for QUIET_MS, longer than the contact window's 200 ms debounce. A query
// whose list is not final within SETTLE_LIMIT_MS is reported incomplete.
const QUIET_MS = 500;
const SETTLE_LIMIT_MS = 30_000 + LATENCY_MS;
// Polls run every 50 ms; a longer gap means the page was busy.
const STALL_MS = 150;

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
// follows its input event: the next paint. `type` adds how late the key was
// sent. Each list change is logged with the rows on screen, so arrival of
// final results can be timed too. `lastActivity` is the last input, paint,
// list change or contact read, for `settle`.
function instrument() {
  const m = {
    keys: [],
    changes: [],
    frames: [],
    recording: false,
    keydowns: 0,
    lastActivity: 0,
  };
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
      // The combobox sends its listbox an ArrowDown of its own after each
      // input. Each press sends one trusted keydown, so this numbers keys in
      // typing order.
      if (!m.recording || !event.isTrusted) return;
      pending = { key: event.key, index: m.keydowns++, t0: event.timeStamp };
    },
    true
  );
  document.addEventListener(
    'input',
    () => {
      m.lastActivity = performance.now();
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
          m.lastActivity = record.painted;
        };
        channel.port2.postMessage(0);
      });
    },
    true
  );
  const readState = () =>
    ['reads', 'pending-reads']
      .map((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent)
      .join('/');
  let last = '';
  let lastReads = '';
  new MutationObserver(() => {
    const now = performance.now();
    const reads = readState();
    if (reads !== lastReads) {
      lastReads = reads;
      m.lastActivity = now;
    }
    const shown = rows();
    const key = JSON.stringify(shown);
    if (key === last) return;
    last = key;
    m.lastActivity = now;
    if (m.recording) m.changes.push({ t: now, rows: shown });
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

let settles = 0;
/** Waits until `keys` keystrokes have painted, no contact read is pending and
 * nothing has changed for QUIET_MS while the page kept answering. Returns
 * false if that takes too long. */
async function settle(page, keys) {
  const id = ++settles;
  try {
    await page.waitForFunction(
      ({ id, keys, quiet, stall }) => {
        const m = window.__share;
        const pending = document.querySelector('[data-testid="pending-reads"]');
        if (!pending) throw new Error('This build has no pending read count');
        // After a gap between polls the page was busy, and the timers it held
        // back (the contact window's debounce among them) run only now: the
        // quiet time starts again.
        const now = performance.now();
        if (m.settle !== id || now - m.lastPoll > stall) m.quietFrom = now;
        m.settle = id;
        m.lastPoll = now;
        return (
          m.keys.length >= keys &&
          pending.textContent === '0' &&
          now - Math.max(m.lastActivity, m.quietFrom) >= quiet
        );
      },
      { id, keys, quiet: QUIET_MS, stall: STALL_MS },
      { polling: 50, timeout: SETTLE_LIMIT_MS }
    );
    return true;
  } catch (error) {
    if (error instanceof errors.TimeoutError) return false;
    throw error;
  }
}

async function open(browser, port, groups, throttle) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(instrument);
  await page.goto(
    `http://127.0.0.1:${port}/?share-recipients&groups=${groups}&people=${PEOPLE}&dms=${DMS}&latency=${LATENCY_MS}`
  );
  const input = page.getByPlaceholder('To: Email or group');
  await input.waitFor({ timeout: 120_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await input.click();
  if (!(await settle(page, 0))) throw new Error('The list never settled');
  return { context, page, cdp, errors: pageErrors, runs: [] };
}

/** Types `query` at the set cadence, waits for results, and clears it. */
async function type(session, query, profilePath) {
  const { page, cdp } = session;
  if (profilePath) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => {
    const m = window.__share;
    m.keys = [];
    m.changes = [];
    m.frames = [];
    m.keydowns = 0;
    m.recording = true;
  });
  const start = performance.now();
  // How late each key was sent. A press returns once the page has taken the
  // key, so a busy page holds back the next one; that wait counts too.
  const late = [];
  for (let index = 0; index < query.length; index++) {
    const due = start + index * CADENCE_MS;
    const wait = due - performance.now();
    if (wait > 0) await page.waitForTimeout(wait);
    late.push(Math.max(0, performance.now() - due));
    await page.keyboard.press(query[index] === ' ' ? 'Space' : query[index]);
  }
  const complete = await settle(page, query.length);
  const run = await page.evaluate(() => {
    const m = window.__share;
    m.recording = false;
    return { keys: m.keys, changes: m.changes, frames: m.frames };
  });
  if (profilePath) {
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(profilePath, JSON.stringify(profile));
  }
  if (
    complete &&
    (run.keys.length !== late.length ||
      run.keys.some((key, index) => key.index !== index))
  )
    throw new Error(`Timed ${run.keys.length} of ${late.length} keys`);
  const last = run.keys.at(-1);
  const final = run.changes.at(-1);
  // The list is final at the paint after the last keystroke, or at its last
  // change after that keystroke when results land later.
  const lastChange = final && last && final.t >= last.t0 ? final.t : 0;
  const settledAt = last ? Math.max(last.painted, lastChange) : undefined;
  session.runs.push({
    query,
    // An incomplete run's list was still changing or reading when the wait
    // ended, so it has no final list or settled time.
    complete,
    keys: run.keys.map((key) => ({
      key: key.key,
      index: key.index,
      late: late[key.index],
      toPaint: late[key.index] + key.painted - key.t0,
      queued: late[key.index] + key.handled - key.t0,
      people: key.rows.filter((row) => row.person).length,
      rows: key.rows.length,
    })),
    settledAfterLastKey:
      complete && settledAt != null && last
        ? late[last.index] + settledAt - last.t0
        : null,
    finalRows: complete ? (final?.rows ?? last?.rows ?? []) : null,
    longFrames: run.frames,
  });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  // A list still busy here would spill into the next query's timings, so
  // this page types no more.
  if (!(await settle(page, 0)))
    session.stuck = `the list never settled after clearing "${query}"`;
}

const max = (values) => (values.length ? Math.max(...values) : null);

function summarize(label, groups, throttle, runs) {
  // An incomplete run can lack its slowest keys and its final list, so only
  // complete runs count.
  const complete = runs.filter((run) => run.complete);
  const keys = complete.flatMap((run) => run.keys);
  const toPaint = keys.map((key) => key.toPaint);
  const settled = complete.map((run) => run.settledAfterLastKey);
  return {
    build: label,
    groups,
    throttle,
    keystrokes: keys.length,
    toPaintP50: round(quantile(toPaint, 0.5)),
    toPaintP95: round(quantile(toPaint, 0.95)),
    toPaintMax: round(max(toPaint)),
    settledP50: round(quantile(settled, 0.5)),
    settledMax: round(max(settled)),
    // Keystrokes after which the list painted empty although the query ends
    // with results: no listed row matched the text until its read landed.
    emptyKeys: complete
      .filter((run) => run.finalRows.length > 0)
      .flatMap((run) => run.keys)
      .filter((key) => key.rows === 0).length,
    incompleteRuns: runs.length - complete.length,
    longFrameMsPerQuery: complete.length
      ? round(
          complete
            .flatMap((run) => run.longFrames)
            .reduce((sum, frame) => sum + frame.duration, 0) / complete.length
        )
      : null,
  };
}

fs.mkdirSync(out, { recursive: true });
const servers = await Promise.all(builds.map((build) => serve(build.dist)));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const summary = [];
const failures = [];
try {
  for (const groups of SIZES)
    for (const throttle of THROTTLES) {
      // Every build's page stays open, and each repetition types into them
      // in turn, alternating which goes first.
      const sessions = [];
      for (const [index, build] of builds.entries())
        sessions.push(
          await open(browser, servers[index].address().port, groups, throttle)
        );
      for (let rep = 0; rep < REPS; rep++) {
        const order = [...builds.keys()];
        if (rep % 2) order.reverse();
        for (const index of order)
          for (const query of QUERIES) {
            if (sessions[index].stuck) break;
            const profile =
              rep === 0 &&
              query === QUERIES[0] &&
              throttle === Math.max(...THROTTLES);
            await type(
              sessions[index],
              query,
              profile
                ? `${out}/${builds[index].label}-groups-${groups}-x${throttle}.cpuprofile`
                : undefined
            );
          }
      }
      for (const [index, build] of builds.entries()) {
        const session = sessions[index];
        await session.context.close();
        const cell = `${build.label}, ${groups} groups, ${throttle}x`;
        if (session.stuck) failures.push(`${cell}: ${session.stuck}`);
        for (const error of session.errors) failures.push(`${cell}: ${error}`);
        fs.writeFileSync(
          `${out}/${build.label}-groups-${groups}-x${throttle}.json`,
          JSON.stringify({ label: build.label, groups, throttle, runs: session.runs })
        );
        const row = summarize(build.label, groups, throttle, session.runs);
        summary.push(row);
        console.log(JSON.stringify(row));
      }
    }
} finally {
  await browser.close();
  for (const server of servers) server.close();
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
}
if (failures.length) throw new Error(failures.join('\n'));
