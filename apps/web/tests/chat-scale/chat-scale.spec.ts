/**
 * Chat over 3,500 and 7,000 joined channels in the built app, in Chromium,
 * over the account in `fixture.ts`. Each size seeds the browser's cache with one visit, then measures the next load
 * and what a viewer does in it: the page's heap after a forced collection,
 * long tasks, DOM size, and the requests each step made. `limits.ts` holds
 * the loose limits a run fails on.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type CDPSession,
  type ConsoleMessage,
  expect,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';
import {
  type ChatFixture,
  createChatFixture,
  FIXTURE_NOW,
} from './fixture';
import { type Backend, type BackendCounts, createBackend } from './backend';
import {
  type ChatScaleRun,
  limitFailures,
  STEP_NAMES,
  type StepMeasure,
  type StepName,
  summaryTable,
} from './limits';

const SIZES = [3_500, 7_000] as const;
/** One seed, so every run loads the same account. */
const FIXTURE_SEED = 1;
const DIST = fileURLToPath(
  new URL('../../node_modules/.chat-scale-dist', import.meta.url)
);
const RESULTS_PATH = resolve(
  process.env.CHAT_SCALE_OUT ??
    fileURLToPath(
      new URL('../../.cache/chat-scale/results.json', import.meta.url)
    )
);
const SUMMARY_PATH = join(dirname(RESULTS_PATH), 'summary.md');
/** A step has settled once no request arrived for this long: longer than
 * the channel directory's 2 s refresh spacing. */
const QUIET_MS = 3_000;
/** Rows (headings and channels) on screen that count as Chat having opened. */
const FIRST_ROWS = 15;
const SCROLL_STEPS = 20;
const TOGGLED_SECTION = 'Direct messages';
const PERFORMANCE_METRICS = [
  'LayoutCount',
  'RecalcStyleCount',
  'ScriptDuration',
  'TaskDuration',
] as const;

type PageState = {
  longTasks: Array<[start: number, duration: number]>;
  rowsAt: number | undefined;
};

type Metrics = Record<(typeof PERFORMANCE_METRICS)[number], number>;

const ZERO_METRICS = Object.fromEntries(
  PERFORMANCE_METRICS.map((name) => [name, 0])
) as Metrics;

/** Runs in every document before the app: long tasks from the start, and
 * when the rail first shows `firstRows` rows. */
function observePage(firstRows: number): void {
  const state: PageState = { longTasks: [], rowsAt: undefined };
  Object.assign(globalThis, { chatScale: state });
  localStorage.setItem('macro:login', 'true');
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      state.longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: 'longtask', buffered: true });
  const rows = new MutationObserver(() => {
    const shown = document.querySelectorAll(
      '[role="tree"] [role="treeitem"]'
    ).length;
    if (shown < firstRows) return;
    state.rowsAt = performance.now();
    rows.disconnect();
  });
  rows.observe(document, { childList: true, subtree: true });
}

/** A console error with its arguments in full: the app's logger puts the
 * stack in an attributes object, which the message text cuts short. */
async function readConsoleError(
  message: ConsoleMessage,
  into: string[]
): Promise<void> {
  const values = await Promise.all(
    message.args().map(async (arg) => {
      try {
        return await arg.jsonValue();
      } catch {
        return null;
      }
    })
  );
  into.push(values.length > 0 ? JSON.stringify(values) : message.text());
}

async function readPageState(page: Page): Promise<PageState> {
  return await page.evaluate(
    () => (globalThis as unknown as { chatScale: PageState }).chatScale
  );
}

async function readMetrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  return Object.fromEntries(
    PERFORMANCE_METRICS.map((name) => [name, byName.get(name) ?? 0])
  ) as Metrics;
}

/** Every channel off the first page that no favorite or section holds, so a
 * message moves it into view. */
function messageChannel(fixture: ChatFixture): string {
  const held = new Set([
    ...fixture.favoriteChannelIds,
    ...(['team', 'personal'] as const).flatMap((scope) =>
      fixture.labels(scope).labels.flatMap((label) => label.channelIds)
    ),
  ]);
  const channel = fixture.channels
    .slice(1_000)
    .find(
      (candidate) =>
        (candidate.channelType === 'public' ||
          candidate.channelType === 'private') &&
        !held.has(candidate.id)
    );
  if (!channel) throw new Error('The fixture has no channel to message');
  return channel.id;
}

type Session = {
  page: Page;
  cdp: CDPSession;
  backend: Backend;
  pageErrors: string[];
};

/** One step's cost: run it, wait until the app is quiet, collect garbage,
 * then read the heap, the DOM, and the long tasks and requests since it
 * started. `navigates` resets the counters the new document starts from. */
async function measure(
  session: Session,
  navigates: boolean,
  action: () => Promise<void>
): Promise<StepMeasure> {
  const { page, cdp, backend } = session;
  const mark: BackendCounts = backend.counts();
  const before = navigates ? ZERO_METRICS : await readMetrics(cdp);
  const startedAt = navigates
    ? 0
    : await page.evaluate(() => performance.now());
  const started = Date.now();
  await action();
  const settled = await backend.quiet(QUIET_MS);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const after = await readMetrics(cdp);
  const state = await readPageState(page);
  const tasks = state.longTasks
    .filter(([start]) => start >= startedAt)
    .map(([, duration]) => duration);
  const domNodes = await page.evaluate(
    () => document.getElementsByTagName('*').length
  );
  const memory = await page.evaluate(async () => {
    const measureMemory = (
      performance as {
        measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      }
    ).measureUserAgentSpecificMemory;
    if (!crossOriginIsolated || !measureMemory) return null;
    // Chromium refuses it in some isolated pages (headless shells among
    // them); the heap reading stands without it.
    try {
      return (await measureMemory.call(performance)).bytes;
    } catch {
      return null;
    }
  });
  return {
    settleMs: Math.max(0, settled - started),
    rowsMs: navigates ? (state.rowsAt ?? null) : null,
    longTasks: {
      count: tasks.length,
      totalMs: Math.round(tasks.reduce((sum, each) => sum + each, 0)),
      maxMs: Math.round(Math.max(0, ...tasks)),
    },
    heapMb: heap.usedSize / 2 ** 20,
    agentMemoryMb: memory === null ? null : memory / 2 ** 20,
    domNodes,
    metrics: Object.fromEntries(
      PERFORMANCE_METRICS.map((name) => [
        name,
        Math.round((after[name] - before[name]) * 1_000) / 1_000,
      ])
    ),
    requests: backend.since(mark),
  };
}

async function measureSize(
  browser: Browser,
  channels: number,
  testInfo: TestInfo
): Promise<ChatScaleRun> {
  const fixture = createChatFixture(channels, FIXTURE_SEED);
  const backend = createBackend(DIST, fixture);
  const server = await backend.serve();
  const context = await browser.newContext();
  let diagnose = async (): Promise<unknown> => ({ requests: backend.log() });
  try {
    await context.addInitScript(observePage, FIRST_ROWS);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) =>
      pageErrors.push(`${error.message}\n${error.stack ?? ''}`)
    );
    const consoleReads: Array<Promise<void>> = [];
    page.on('console', (message) => {
      if (message.type() === 'error')
        consoleReads.push(readConsoleError(message, consoleErrors));
    });
    diagnose = async () => ({
      requests: backend.log(),
      backendErrors: backend.errors(),
      pageErrors,
      consoleErrors: await Promise.all(consoleReads).then(() => consoleErrors),
    });
    await backend.routePage(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const session: Session = { page, cdp, backend, pageErrors };
    const rail = page.getByRole('tree', { name: 'Conversations' });
    const rowsShown = () =>
      expect(rail.getByRole('treeitem').nth(FIRST_ROWS - 1)).toBeVisible();
    const steps = {} as Record<StepName, StepMeasure>;

    // The earlier visit: the channel lane's whole pass into an empty cache.
    steps.seed = await measure(session, true, async () => {
      const pass = backend.channelPassFinished();
      await page.goto(`${server.origin}/app/channels`);
      await rowsShown();
      await pass;
    });
    // The next load, over the cache that visit left.
    steps.coldOpen = await measure(session, true, async () => {
      await page.reload();
      await rowsShown();
    });
    steps.message = await measure(session, false, async () => {
      const frames = fixture.deliverMessage(
        messageChannel(fixture),
        FIXTURE_NOW + 60_000
      );
      expect(
        await backend.push('SoupUpdates', frames.SoupUpdates),
        'the page subscribed to SoupUpdates'
      ).toBeGreaterThan(0);
      expect(
        await backend.push('NotificationUpdates', frames.NotificationUpdates),
        'the page subscribed to NotificationUpdates'
      ).toBeGreaterThan(0);
    });
    const scroller = rail.locator('.overflow-y-auto').first();
    steps.scroll = await measure(session, false, async () => {
      for (let step = 0; step < SCROLL_STEPS; step += 1) {
        await scroller.evaluate(async (element) => {
          element.scrollTop += element.clientHeight;
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
      }
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
    });
    const heading = rail.getByRole('treeitem', { name: TOGGLED_SECTION });
    steps.collapse = await measure(session, false, async () => {
      await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded', 'false');
    });
    steps.expand = await measure(session, false, async () => {
      await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded', 'true');
    });
    return {
      channels,
      steps,
      backendErrors: backend.errors(),
      pageErrors,
      requests: backend.counts(),
    };
  } catch (error) {
    writeFileSync(
      testInfo.outputPath(`chat-scale-${channels}-diagnostics.json`),
      JSON.stringify(await diagnose(), null, 2)
    );
    throw error;
  } finally {
    await context.close();
    await server.close();
  }
}

test.describe.configure({ mode: 'serial' });

const runs: ChatScaleRun[] = [];

function writeResults(): void {
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, `${JSON.stringify({ sizes: runs }, null, 2)}\n`);
  writeFileSync(SUMMARY_PATH, `${summaryTable(runs)}\n`);
}

for (const channels of SIZES) {
  test(`Chat at ${channels} channels`, async ({ browser }, testInfo) => {
    const run = await measureSize(browser, channels, testInfo);
    runs.push(run);
    writeResults();
    await testInfo.attach(`chat-scale-${channels}.json`, {
      body: JSON.stringify(run, null, 2),
      contentType: 'application/json',
    });
    expect(run.pageErrors, 'uncaught errors in the page').toEqual([]);
    for (const name of STEP_NAMES)
      expect(run.steps[name], `${name} was measured`).toBeDefined();
  });
}

test('stays within its limits', () => {
  expect(
    limitFailures(runs),
    'Chat scale limits (tests/chat-scale/AGENTS.md)'
  ).toEqual([]);
});
