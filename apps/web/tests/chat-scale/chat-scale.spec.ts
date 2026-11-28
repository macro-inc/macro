/**
 * Chat over 3,500 and 7,000 joined channels in the built app, in Chromium,
 * over the account in `fixture.ts`. Each size seeds the browser's cache with one visit, then measures the next load
 * and what a viewer does in it: the page's heap after a forced collection,
 * long tasks, DOM size, and the requests each step made. `limits.ts` holds
 * the loose limits a run fails on; each step also checks it did what it is
 * named for, so a step that did nothing cannot pass as a cheap one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type CDPSession,
  type ConsoleMessage,
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';
import { type Backend, type BackendCounts, createBackend } from './backend';
import {
  type ChatFixture,
  createChatFixture,
  FIXTURE_NOW,
  MIN_OUTSIDE_FIRST_PAGES,
  MIN_SECTION_COVERAGE,
  type SectionCoverage,
  sectionCoverage,
  VIEWER_ID,
} from './fixture';
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
/** A step has settled once nothing was in flight or moved for this long:
 * longer than the channel directory's 2 s refresh spacing. */
const QUIET_MS = 3_000;
/** Conversation rows on screen (section headings, which carry
 * `aria-expanded`, not counted) that count as Chat having opened. */
const FIRST_ROWS = 15;
const ROW = '[role="treeitem"]:not([aria-expanded])';
const SCROLL_STEPS = 20;
/** Pages read back up from the rail's end for its headings: more than
 * Direct messages spans at 7,000 channels. */
const HEADING_PAGES = 400;
/** Jumps to the rail's end before it holds there. */
const END_JUMPS = 20;
/** Frames in a row the rail's scroll height must hold for, after a jump
 * or a page, before its headings are read; at most `SETTLE_FRAMES`. */
const STABLE_FRAMES = 5;
const SETTLE_FRAMES = 120;
/** Passes from the end up, each from a fresh jump to the end, before the
 * headings check gives up on a heading. */
const HEADING_PASSES = 3;
/** How often, and for how long, a load waits for the channel lane to
 * record its finished pass after the last page was served. */
const LANE_POLL_MS = 250;
const LANE_TIMEOUT_MS = 120_000;
const TOGGLED_SECTION = 'Direct messages';
/** Chat's saved view (`features/channels-view/persistence.ts`), per viewer. */
const SAVED_VIEW_KEY = 'macro:channels:view-state:v1';
/** `CHANNEL_DIRECTORY_CHECKPOINT_ID` (`lib/queries/channel/directory-lane.ts`),
 * the last part of the channel lane's checkpoint key in `localStorage`. */
const CHANNEL_LANE_KEY_SUFFIX = ':channel-directory-reconciled';
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

/** The channel lane's checkpoint, as the app stored it. */
type LaneCheckpoint = {
  completed: boolean;
  completedAt: string | null;
  storageGeneration: string | null;
} | null;

/** What shows each step did its job, beside what it cost. */
type RunEvidence = {
  /** The lane's checkpoint after the seed and after the next load: the same
   * storage generation means the load reopened the cache the seed wrote. */
  lane: { seed: LaneCheckpoint; coldOpen: LaneCheckpoint };
  /** The origin's storage (`navigator.storage.estimate`), cache files
   * included. */
  storageMb: { seed: number; coldOpen: number };
  /** Whether the messaged direct message's row was among the rows at the
   * top of the rail: off it before the message, moved onto it after. */
  messagedRow: { before: boolean; after: boolean };
  scroll: {
    /** The element that scrolled, by tag and class. */
    scroller: string;
    deepestTop: number;
    pageHeight: number;
    reachedBottom: boolean;
    /** Channels whose rows mounted on the way down that the top did not
     * show. */
    newRows: number;
  };
  /** Mounted rows of direct messages only that section holds, at the top
   * of the rail. A collapsed section keeps its unread conversations listed,
   * so its other rows go (`hidden`) and come back on expanding
   * (`restored`). */
  directMessageRows: {
    before: number;
    collapsed: number;
    expanded: number;
    hidden: number;
    restored: number;
  };
  /** How much of the account the sections name, checked before the seed. */
  sections: SectionCoverage;
  /** The section headings the rail showed after the run, from its end up
   * to Team channels: the viewer's saved state collapsed all but
   * Favorites, Direct messages and one team section. */
  savedView: { headings: Heading[] };
};

type Heading = { key: string; expanded: boolean };

const ZERO_METRICS = Object.fromEntries(
  PERFORMANCE_METRICS.map((name) => [name, 0])
) as Metrics;

/** Runs in every document before the app: long tasks from the start, when
 * the rail first shows `firstRows` rows, and the viewer's saved Chat state
 * unless the app has written its own. */
function observePage({
  firstRows,
  row,
  savedViewKey,
  savedView,
}: {
  firstRows: number;
  row: string;
  savedViewKey: string;
  savedView: string;
}): void {
  const state: PageState = { longTasks: [], rowsAt: undefined };
  Object.assign(globalThis, { chatScale: state });
  localStorage.setItem('macro:login', 'true');
  if (localStorage.getItem(savedViewKey) === null)
    localStorage.setItem(savedViewKey, savedView);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      state.longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: 'longtask', buffered: true });
  const rows = new MutationObserver(() => {
    const shown = document.querySelectorAll(`[role="tree"] ${row}`).length;
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

async function readLaneCheckpoint(page: Page): Promise<LaneCheckpoint> {
  return await page.evaluate((suffix) => {
    const key = Object.keys(localStorage).find(
      (each) =>
        each.startsWith('graphql-soup-backfill:') && each.endsWith(suffix)
    );
    const text = key === undefined ? null : localStorage.getItem(key);
    if (text === null) return null;
    const stored = JSON.parse(text) as {
      completed?: boolean;
      completedAt?: string | null;
      storageGeneration?: string | null;
    };
    return {
      completed: stored.completed === true,
      completedAt: stored.completedAt ?? null,
      storageGeneration: stored.storageGeneration ?? null,
    };
  }, CHANNEL_LANE_KEY_SUFFIX);
}

/** Waits until the channel lane's checkpoint records a finished pass that
 * completed after `after` (any finished pass when null). */
async function laneFinished(page: Page, after: string | null): Promise<void> {
  await page.waitForFunction(
    ({ suffix, after }) => {
      const key = Object.keys(localStorage).find(
        (each) =>
          each.startsWith('graphql-soup-backfill:') && each.endsWith(suffix)
      );
      const text = key === undefined ? null : localStorage.getItem(key);
      if (text === null) return false;
      const stored = JSON.parse(text) as {
        completed?: boolean;
        completedAt?: string | null;
      };
      return (
        stored.completed === true &&
        typeof stored.completedAt === 'string' &&
        (after === null || Date.parse(stored.completedAt) > Date.parse(after))
      );
    },
    { suffix: CHANNEL_LANE_KEY_SUFFIX, after },
    { polling: LANE_POLL_MS, timeout: LANE_TIMEOUT_MS }
  );
}

async function readStorageMb(page: Page): Promise<number> {
  const bytes = await page.evaluate(
    async () => (await navigator.storage.estimate()).usage ?? 0
  );
  return Math.round((bytes / 2 ** 20) * 10) / 10;
}

/** The channels whose only row is in the toggled section: direct messages
 * no favorite or custom section also holds. */
function sectionOnlyDirectMessages(fixture: ChatFixture): Set<string> {
  const held = new Set([
    ...fixture.favoriteChannelIds,
    ...(['team', 'personal'] as const).flatMap((scope) =>
      fixture.labels(scope).labels.flatMap((label) => label.channelIds)
    ),
  ]);
  return new Set(
    fixture.channels
      .filter(
        (channel) =>
          channel.channelType === 'direct_message' && !held.has(channel.id)
      )
      .map((channel) => channel.id)
  );
}

/** A direct message far down its section (past the first thousand
 * channels) that no favorite or custom section shows: a message moves it to
 * the top of Direct messages, on screen. A channel in All channels would
 * not show without scrolling every section above it in. */
function messageChannel(fixture: ChatFixture): string {
  const sectionOnly = sectionOnlyDirectMessages(fixture);
  const channel = fixture.channels
    .slice(1_000)
    .find((candidate) => sectionOnly.has(candidate.id));
  if (!channel) throw new Error('The fixture has no direct message to message');
  return channel.id;
}

/** The channel each mounted row shows (`<rail>-channel:<id>`, with
 * `:label:<label>` in a custom section); favorites and headings have none. */
async function mountedChannels(rail: Locator): Promise<string[]> {
  const ids = await rail
    .locator(ROW)
    .evaluateAll((rows) => rows.map((row) => row.id));
  return ids.flatMap((id) => {
    const channel = id.split('-channel:')[1]?.split(':label:')[0];
    return channel ? [channel] : [];
  });
}

/** Marks the element that scrolls the rail: the tree or its nearest
 * scrolling ancestor, else a scrolling element inside it. */
async function railScroller(
  rail: Locator
): Promise<{ scroller: Locator; described: string }> {
  const described = await rail.evaluate((tree) => {
    const scrolls = (element: Element) => {
      const { overflowY } = getComputedStyle(element);
      return (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight + 1
      );
    };
    let found: Element | null = tree;
    while (found && !scrolls(found)) found = found.parentElement;
    found ??= [...tree.querySelectorAll('*')].find(scrolls) ?? null;
    if (!found) return null;
    found.setAttribute('data-chat-scale-scroller', '');
    return `${found.tagName.toLowerCase()}.${[...found.classList].join('.')}`;
  });
  expect(described, 'an element scrolls the rail').not.toBeNull();
  return {
    scroller: rail.page().locator('[data-chat-scale-scroller]'),
    described: described ?? '',
  };
}

/** Scrolls one page and waits two frames, so the virtualizer has mounted
 * the rows now in view. */
async function scrollOnePage(scroller: Locator) {
  return await scroller.evaluate(async (element) => {
    element.scrollTop += element.clientHeight;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      top: element.scrollTop,
      pageHeight: element.clientHeight,
      atBottom:
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
    };
  });
}

/** The headings mounted now, by row key (`section:<group>` or
 * `label:<id>`, after the rail's id in the DOM id). */
async function mountedHeadings(rail: Locator): Promise<Heading[]> {
  const found = await rail
    .locator('[role="treeitem"][aria-expanded]')
    .evaluateAll((items) =>
      items.map((item) => ({
        id: item.id,
        expanded: item.getAttribute('aria-expanded') === 'true',
      }))
    );
  return found.flatMap(({ id, expanded }) => {
    const key = /-((?:section|label):.+)$/.exec(id)?.[1];
    return key ? [{ key, expanded }] : [];
  });
}

/** Whether each section's heading should read open: the built-in groups
 * and every custom section, as `fixture.savedView` saved them. */
function savedHeadings(fixture: ChatFixture): Record<string, boolean> {
  const { expandedGroups, collapsedLabels } = fixture.savedView;
  const labels = (['team', 'personal'] as const).flatMap(
    (scope) => fixture.labels(scope).labels
  );
  return {
    ...Object.fromEntries(
      Object.entries(expandedGroups).map(([group, open]) => [
        `section:${group}`,
        open,
      ])
    ),
    ...Object.fromEntries(
      labels.map((label) => [
        `label:${label.id}`,
        !collapsedLabels.includes(label.id),
      ])
    ),
  };
}

/** Moves the scroller to its end or one page up, then waits until its
 * scroll height holds for `STABLE_FRAMES` frames, as the rail measures the
 * sections the move mounted. Returns where it started, whether the height
 * held before `SETTLE_FRAMES` ran out, and whether it rests at the end. */
async function scrollAndSettle(
  scroller: Locator,
  to: 'end' | 'pageUp'
): Promise<{ from: number; settled: boolean; atEnd: boolean }> {
  return await scroller.evaluate(
    async (element, { to, stableFrames, settleFrames }) => {
      const from = element.scrollTop;
      if (to === 'end') element.scrollTop = element.scrollHeight;
      else element.scrollTop -= element.clientHeight;
      let height = element.scrollHeight;
      let stable = 0;
      for (let frame = 0; frame < settleFrames; frame += 1) {
        if (stable >= stableFrames) break;
        await new Promise(requestAnimationFrame);
        stable = element.scrollHeight === height ? stable + 1 : 0;
        height = element.scrollHeight;
      }
      return {
        from,
        settled: stable >= stableFrames,
        atEnd:
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      };
    },
    { to, stableFrames: STABLE_FRAMES, settleFrames: SETTLE_FRAMES }
  );
}

/** Jumps to the rail's end and pages back up until every expected heading
 * has mounted or the top is reached, collecting the headings on the way.
 * The rail virtualizes its sections at estimated heights, so one jump lands
 * short of the end once they are measured: it jumps until the end holds,
 * and starts over from the end while a heading is still missing. */
async function headingsFromTheEnd(
  rail: Locator,
  scroller: Locator,
  expected: Record<string, boolean>
): Promise<Heading[]> {
  const seen = new Map<string, boolean>();
  const collect = async () => {
    for (const heading of await mountedHeadings(rail))
      seen.set(heading.key, heading.expanded);
    return Object.keys(expected).every((key) => seen.has(key));
  };
  for (let pass = 0; pass < HEADING_PASSES; pass += 1) {
    for (let jump = 0; jump < END_JUMPS; jump += 1) {
      const { settled, atEnd } = await scrollAndSettle(scroller, 'end');
      if ((await collect()) || (settled && atEnd)) break;
    }
    for (let page = 0; page < HEADING_PAGES; page += 1) {
      if (await collect()) break;
      const { from } = await scrollAndSettle(scroller, 'pageUp');
      if (from === 0) break;
    }
    if (await collect()) break;
  }
  await scrollToTop(scroller);
  return [...seen].map(([key, expanded]) => ({ key, expanded }));
}

async function scrollToTop(scroller: Locator): Promise<void> {
  await scroller.evaluate(async (element) => {
    element.scrollTop = 0;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

/** The channels whose rows are mounted at the top of the rail. */
async function topChannels(
  rail: Locator,
  scroller: Locator
): Promise<string[]> {
  await scrollToTop(scroller);
  return await mountedChannels(rail);
}

type Session = {
  page: Page;
  cdp: CDPSession;
  backend: Backend;
  fixture: ChatFixture;
  rail: Locator;
  pageErrors: string[];
  /** The step running, under which each page error is filed. */
  at: { step: string };
};

/** One step's cost: run it and wait until the app is quiet; then take the
 * requests and server reads since it started, the long tasks, metrics and
 * DOM, and only then collect garbage, which runs as a task of its own, and
 * read the heap. `navigates` resets the counters the new document starts
 * from. */
async function measure(
  session: Session,
  name: StepName,
  navigates: boolean,
  action: () => Promise<void>
): Promise<StepMeasure> {
  const { page, cdp, backend, fixture, rail } = session;
  session.at.step = name;
  const mark: BackendCounts = backend.counts();
  const readMark = fixture.reads();
  const before = navigates ? ZERO_METRICS : await readMetrics(cdp);
  const startedAt = navigates
    ? 0
    : await page.evaluate(() => performance.now());
  const started = Date.now();
  await action();
  const settled = await backend.quiet(QUIET_MS);
  // Counted the moment the step settles, so a poll or socket update that
  // lands during the readings below is not this step's.
  const reads = fixture.readsSince(readMark);
  const requests = backend.since(mark);
  const after = await readMetrics(cdp);
  const state = await readPageState(page);
  const tasks = state.longTasks
    .filter(([start]) => start >= startedAt)
    .map(([, duration]) => duration);
  const domNodes = await page.evaluate(
    () => document.getElementsByTagName('*').length
  );
  const rowsMounted = await rail.locator(ROW).count();
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
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
  session.at.step = `after ${name}`;
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
    rowsMounted,
    server: {
      rowsRequested: reads.rowsRequested,
      idsRequested: reads.idsRequested,
      rowsReturned: reads.rowsReturned,
    },
    metrics: Object.fromEntries(
      PERFORMANCE_METRICS.map((name) => [
        name,
        Math.round((after[name] - before[name]) * 1_000) / 1_000,
      ])
    ),
    requests,
  };
}

type SizeResult = { run: ChatScaleRun; evidence: RunEvidence };

async function measureSize(
  browser: Browser,
  channels: number,
  testInfo: TestInfo
): Promise<SizeResult> {
  const fixture = createChatFixture(channels, FIXTURE_SEED);
  // Sections that name only channels the first pages load would leave the
  // rail nothing to resolve: refuse to measure that account.
  const sections = sectionCoverage(fixture);
  expect(
    sections.held / sections.holdable,
    'the sections hold nine in ten of the channels a section can hold'
  ).toBeGreaterThanOrEqual(MIN_SECTION_COVERAGE);
  expect(
    sections.outsideFirstPages / sections.referenced,
    'half the channels sections and favorites name are past the first pages'
  ).toBeGreaterThanOrEqual(MIN_OUTSIDE_FIRST_PAGES);
  const backend = createBackend(DIST, fixture);
  const server = await backend.serve();
  const context = await browser.newContext();
  const evidence: Partial<RunEvidence> = { sections };
  let diagnose = async (): Promise<unknown> => ({
    requests: backend.log(),
    backendErrors: backend.errors(),
  });
  try {
    await context.addInitScript(observePage, {
      firstRows: FIRST_ROWS,
      row: ROW,
      savedViewKey: `${SAVED_VIEW_KEY}:${VIEWER_ID}`,
      savedView: JSON.stringify(fixture.savedView),
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const at = { step: 'setup' };
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) =>
      pageErrors.push(`${at.step}: ${error.message}\n${error.stack ?? ''}`)
    );
    const consoleReads: Array<Promise<void>> = [];
    page.on('console', (message) => {
      if (message.type() === 'error')
        consoleReads.push(readConsoleError(message, consoleErrors));
    });
    diagnose = async () => {
      await Promise.all(consoleReads);
      return {
        evidence,
        requests: backend.log(),
        backendErrors: backend.errors(),
        pageErrors,
        consoleErrors,
      };
    };
    await backend.routePage(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const rail = page.getByRole('tree', { name: 'Conversations' });
    const session: Session = {
      page,
      cdp,
      backend,
      fixture,
      rail,
      pageErrors,
      at,
    };
    const rowsShown = () =>
      expect(rail.locator(ROW).nth(FIRST_ROWS - 1)).toBeVisible();
    const steps = {} as Record<StepName, StepMeasure>;

    // The earlier visit: the channel lane's whole pass into an empty cache.
    steps.seed = await measure(session, 'seed', true, async () => {
      const pass = backend.channelPassFinished();
      await page.goto(`${server.origin}/app/channels`);
      await rowsShown();
      await pass;
      await laneFinished(page, null);
    });
    const seeded = await readLaneCheckpoint(page);
    const seededMb = await readStorageMb(page);
    // The next load, over the cache that visit left, through the channel
    // lane's refresh pass: the lane can pause longer than the quiet window
    // between pages, which would leave the rest of its pass to the next step.
    steps.coldOpen = await measure(session, 'coldOpen', true, async () => {
      const pass = backend.channelPassFinished();
      await page.reload();
      await rowsShown();
      await pass;
      // Within the step: the refresh pass is finished once the lane records
      // it, after the last page was served.
      await laneFinished(page, seeded?.completedAt ?? null);
    });
    evidence.lane = { seed: seeded, coldOpen: await readLaneCheckpoint(page) };
    evidence.storageMb = {
      seed: seededMb,
      coldOpen: await readStorageMb(page),
    };
    expect(seeded, 'the seed finished the channel pass').toMatchObject({
      completed: true,
      completedAt: expect.any(String),
    });
    expect(
      seeded?.storageGeneration,
      'the seed wrote into the browser cache'
    ).toEqual(expect.any(String));
    const reopened = evidence.lane.coldOpen;
    expect(
      reopened?.storageGeneration,
      'the next load reopened the cache the seed wrote'
    ).toBe(seeded?.storageGeneration);
    expect(
      reopened?.completed === true &&
        Date.parse(reopened.completedAt ?? '') >
          Date.parse(seeded?.completedAt ?? ''),
      'the next load finished its own refresh pass'
    ).toBe(true);

    const { scroller, described } = await railScroller(rail);
    evidence.savedView = { headings: [] };
    const messaged = messageChannel(fixture);
    const before = (await topChannels(rail, scroller)).includes(messaged);
    await backend.quiet(QUIET_MS);
    steps.message = await measure(session, 'message', false, async () => {
      const frames = fixture.deliverMessage(messaged, FIXTURE_NOW + 60_000);
      expect(
        await backend.push('SoupUpdates', frames.SoupUpdates),
        'the page subscribed to SoupUpdates'
      ).toBeGreaterThan(0);
      expect(
        await backend.push('NotificationUpdates', frames.NotificationUpdates),
        'the page subscribed to NotificationUpdates'
      ).toBeGreaterThan(0);
      // Part of the step: the row the message moves up mounts at the top.
      await expect(
        rail.locator(`${ROW}[id$="-channel:${messaged}"]`)
      ).toBeVisible();
    });
    evidence.messagedRow = {
      before,
      after: (await topChannels(rail, scroller)).includes(messaged),
    };
    expect(
      evidence.messagedRow,
      'the messaged direct message moved to the top of the rail'
    ).toEqual({ before: false, after: true });
    await backend.quiet(QUIET_MS);

    const topRows = new Set(await mountedChannels(rail));
    let deepest = { top: 0, pageHeight: 0, atBottom: false };
    const passed = new Set<string>();
    steps.scroll = await measure(session, 'scroll', false, async () => {
      for (let step = 0; step < SCROLL_STEPS; step += 1) {
        const reached = await scrollOnePage(scroller);
        if (reached.top >= deepest.top) deepest = reached;
        for (const id of await mountedChannels(rail)) passed.add(id);
        if (reached.atBottom) break;
      }
      await scrollToTop(scroller);
    });
    evidence.scroll = {
      scroller: described,
      deepestTop: deepest.top,
      pageHeight: deepest.pageHeight,
      reachedBottom: deepest.atBottom,
      newRows: [...passed].filter((id) => !topRows.has(id)).length,
    };
    expect(
      evidence.scroll.reachedBottom ||
        evidence.scroll.deepestTop >= 5 * evidence.scroll.pageHeight,
      'the rail scrolled five pages or to its end'
    ).toBe(true);
    expect(
      evidence.scroll.newRows,
      'scrolling mounted rows the top did not show'
    ).toBeGreaterThan(0);

    const directMessages = sectionOnlyDirectMessages(fixture);
    const directMessageRows = async () =>
      (await mountedChannels(rail)).filter((id) => directMessages.has(id));
    const shown = await directMessageRows();
    const heading = rail.getByRole('treeitem', { name: TOGGLED_SECTION });
    steps.collapse = await measure(session, 'collapse', false, async () => {
      await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded', 'false');
    });
    const collapsed = new Set(await directMessageRows());
    steps.expand = await measure(session, 'expand', false, async () => {
      await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded', 'true');
    });
    const expanded = new Set(await directMessageRows());
    const hidden = shown.filter((id) => !collapsed.has(id));
    evidence.directMessageRows = {
      before: shown.length,
      collapsed: collapsed.size,
      expanded: expanded.size,
      hidden: hidden.length,
      restored: hidden.filter((id) => expanded.has(id)).length,
    };
    expect(
      evidence.directMessageRows.hidden,
      `collapsing ${TOGGLED_SECTION} hid conversations it showed`
    ).toBeGreaterThan(0);
    expect(
      evidence.directMessageRows.restored,
      `expanding ${TOGGLED_SECTION} brought every one back`
    ).toBe(evidence.directMessageRows.hidden);

    // Not measured: the headings, read from the rail's end back up, show the
    // sections the fixture serves in the state the viewer saved.
    const expected = savedHeadings(fixture);
    const headings = await headingsFromTheEnd(rail, scroller, expected);
    evidence.savedView = { headings };
    expect(
      Object.fromEntries(
        headings
          .filter((heading) => heading.key in expected)
          .map((heading) => [heading.key, heading.expanded])
      ),
      'every section showed its heading, open as the viewer saved it'
    ).toEqual(expected);
    return {
      run: {
        channels,
        steps,
        backendErrors: backend.errors(),
        pageErrors,
        requests: backend.counts(),
      },
      evidence: evidence as RunEvidence,
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
const evidenceBySize: Record<number, RunEvidence> = {};

function writeResults(): void {
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(
    RESULTS_PATH,
    `${JSON.stringify({ sizes: runs, evidence: evidenceBySize }, null, 2)}\n`
  );
  writeFileSync(SUMMARY_PATH, `${summaryTable(runs)}\n`);
}

for (const channels of SIZES) {
  test(`Chat at ${channels} channels`, async ({ browser }, testInfo) => {
    const { run, evidence } = await measureSize(browser, channels, testInfo);
    runs.push(run);
    evidenceBySize[channels] = evidence;
    writeResults();
    await testInfo.attach(`chat-scale-${channels}.json`, {
      body: JSON.stringify({ ...run, evidence }, null, 2),
      contentType: 'application/json',
    });
    expect(run.pageErrors, 'uncaught errors in the page').toEqual([]);
    expect(
      run.backendErrors,
      'requests the backend could not answer (backend.ts)'
    ).toEqual([]);
    for (const name of STEP_NAMES)
      expect(run.steps[name], `${name} was measured`).toBeDefined();
  });
}

// Named for both sizes so `-g 3500` runs it too, over the one size measured.
test(`stays within its limits at ${SIZES.join(' and ')} channels`, () => {
  expect(
    limitFailures(runs),
    'Chat scale limits (tests/chat-scale/AGENTS.md)'
  ).toEqual([]);
});
