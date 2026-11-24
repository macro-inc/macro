import {
  SoupBackfillDocument,
  SoupMailBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import fc from 'fast-check';
import { match } from 'ts-pattern';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUP_BACKFILL_LANES,
  runSoupBackfill,
  runSoupBackfills,
  type SoupBackfillCheckpoint,
  type SoupBackfillParams,
} from './backfill';
import {
  soupBackfillCheckpointKey,
  soupBackfillCoordinatorKey,
  soupBackfillLeadershipLock,
} from './backfill-contract';
import { installBrowserLocks } from './browser-locks.test-helpers';

vi.mock('../contacts/backfill', () => ({ useContactBackfill: () => {} }));
vi.mock('../contacts/top-up', () => ({ useContactTopUp: () => {} }));
vi.mock('../contacts/use-context-publisher', () => ({
  useContactContextPublisher: () => {},
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
}));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));

type FetchPage = NonNullable<SoupBackfillParams['fetchPage']>;
type Input = Parameters<FetchPage>[0];
type Build = 0 | 1;

/** How a newer build differs from the shipped lanes in one lane. */
type LaneChange = 'same' | 'filter' | 'operation' | 'version' | 'recency';

const LANE_COUNT = DEFAULT_SOUP_BACKFILL_LANES.length;
/** What builds from before contracts elect their backfill leader on. */
const V19_COORDINATOR = 'graphql-soup-backfill:v19:coordinator';
/** Every model step moves the clock on, so no two events share a time. */
const TICK_MS = 1000;

/** The suite tab a fiber runs for; -1 for single-lane runs. */
const TabId = Context.Reference<number>('backfill-builds/TabId', {
  defaultValue: () => -1,
});

function changeLane(
  lane: SoupBackfillParams,
  change: LaneChange
): SoupBackfillParams {
  return match(change)
    .with('same', () => lane)
    .with('filter', () => ({
      ...lane,
      input: {
        ...lane.input,
        filters: {
          ...lane.input.filters,
          teamFilter: { literal: { id: 'newer-build' } },
        } as SoupBackfillParams['input']['filters'],
      },
    }))
    .with('operation', () => ({
      ...lane,
      operation:
        lane.operation === SoupBackfillDocument
          ? SoupMailBackfillDocument
          : SoupBackfillDocument,
    }))
    .with('version', () => ({
      ...lane,
      contractVersion: (lane.contractVersion ?? 0) + 1,
    }))
    .with('recency', () => ({
      ...lane,
      emailRecency: [{ signal: false, days: 7 }],
    }))
    .exhaustive();
}

/**
 * How a run ends before its lane finishes: a page fetch that fails, or the
 * tab closing while a fetch is in flight.
 */
type End = 'fail' | 'close';

type Action =
  | {
      kind: 'run';
      build: Build;
      lane: number;
      /** Pages the run fetches before it ends; 9 lets every lane finish. */
      pages: number;
      end: End;
      /** A record the server changes after the run's `at`th page. */
      update: { at: number; entity: number } | null;
      /** A shipped-lane tab from before checkpoint locks. */
      preLock: boolean;
    }
  | {
      kind: 'concurrent';
      lane: number;
      pages: readonly [number, number];
      ends: readonly [End, End];
      /** Which build's tab asks first. */
      first: Build;
      /** Close the second tab once the first fetched this many pages, while
       * it waits for a lock or as it runs. */
      closeSecondAfter: number | null;
      preLock: boolean;
    }
  | {
      kind: 'suite';
      /** The builds whose tabs run every lane, as a leading tab does, in the
       * order they start; two tabs run at once. */
      tabs: readonly Build[];
      /** Pages each tab fetches before it closes; null runs to the end. */
      pages: readonly [number | null, number | null];
      /** Storage resets just after this many generation samples. */
      resetAtSample: number | null;
    }
  | { kind: 'update'; build: Build; lane: number; entity: number }
  | { kind: 'reset' }
  | { kind: 'reset-during-fetch'; build: Build; lane: number };

const endArb = fc.constantFrom<End>('fail', 'close');
const buildArb = fc.constantFrom<Build>(0, 1);
const laneArb = fc.nat({ max: LANE_COUNT - 1 });

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('run' as const),
      build: buildArb,
      lane: laneArb,
      pages: fc.nat({ max: 9 }),
      end: endArb,
      update: fc.option(
        fc.record({ at: fc.nat({ max: 4 }), entity: fc.nat({ max: 4 }) }),
        { nil: null }
      ),
      preLock: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('concurrent' as const),
      lane: laneArb,
      pages: fc.tuple(fc.nat({ max: 9 }), fc.nat({ max: 9 })),
      ends: fc.tuple(endArb, endArb),
      first: buildArb,
      closeSecondAfter: fc.option(fc.nat({ max: 4 }), { nil: null }),
      preLock: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('suite' as const),
      tabs: fc.constantFrom<readonly Build[]>([0], [1], [0, 1], [1, 0]),
      pages: fc.tuple(
        fc.option(fc.nat({ max: 24 }), { nil: null, freq: 2 }),
        fc.option(fc.nat({ max: 24 }), { nil: null, freq: 2 })
      ),
      resetAtSample: fc.oneof(
        { weight: 3, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: fc.nat({ max: 40 }) }
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('update' as const),
      build: buildArb,
      lane: laneArb,
      entity: fc.nat({ max: 4 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'reset' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('reset-during-fetch' as const),
      build: buildArb,
      lane: laneArb,
    }),
  }
);

type Direction = 'forward' | 'back';

/**
 * Runs that resumed a cursor the other build saved, by lane and direction:
 * `forward` is the newer build resuming the older one, `back` the reverse.
 * Also counts the suite cases the property must reach: two tabs' suites both
 * finished and checked, suites run again after a reset, and writes under a
 * generation a reset ended just after it was sampled.
 */
type Resumes = Map<
  `${number}:${Direction}` | 'suite-pair' | 'suite-after-reset' | 'late-write',
  number
>;

/** A record's versions on the server, each with the time it was written. */
type Versions = { at: number; version: number }[];

type Stored = Omit<SoupBackfillCheckpoint, 'userId'>;

/** The latest version written before `time`, or -1 when none must be held. */
function versionBefore(versions: Versions, time: number): number {
  let version = -1;
  for (const entry of versions) if (entry.at < time) version = entry.version;
  return version;
}

/** When each replay starts; every watermark it saves is later. */
const START = Date.parse('2026-06-01T00:00:00.000Z');

/**
 * The `updatedAt` watermark a pass filters by. Email recency windows filter
 * the same field from days before the replay starts, so they are told apart
 * by time.
 */
function watermarkOf(input: Input): string | null {
  const bounds = [...JSON.stringify(input).matchAll(/"gte":"([^"]+)"/g)]
    .map(([, bound]) => bound)
    .filter((bound) => Date.parse(bound) >= START);
  return bounds[0] ?? null;
}

/** Where a pass without a cursor starts: a request and its watermark. */
const positionOf = (request: string, since: string | null) =>
  `${request}~${since ?? '-'}`;

/** What one checkpoint write is checked against. */
type WriteContext = {
  lane: SoupBackfillParams;
  request: string;
  generation: string;
  /** Older generations a reset ended just after a sample while the writing
   * tab was running, before it sampled again: it may still write under them,
   * and loading discards what it writes. */
  lateGenerations: { has: (generation: string) => boolean };
  /** Called with the generation of each write under an older one. */
  onLate?: (generation: string) => void;
  /** Answers the server gave, by the position a request started from. */
  served: ReadonlyMap<string, ReadonlySet<string | null>>;
};

const parseTime = (iso: string | null) =>
  iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso);

const isFreshPass = (next: Stored) =>
  next.nextCursor === null &&
  !next.completed &&
  next.pagesFetched === 0 &&
  next.updatedSince === null &&
  next.completedAt === null &&
  next.scanStartedAt !== null;

const isSamePass = (previous: Stored, next: Stored) =>
  !next.completed &&
  next.scanStartedAt === previous.scanStartedAt &&
  next.updatedSince === previous.updatedSince &&
  next.completedAt === previous.completedAt;

const isCatchUpStart = (next: Stored) =>
  !next.completed && next.completedAt === null && next.scanStartedAt !== null;

const isCompleted = (next: Stored) =>
  next.completed && next.completedAt !== null && next.scanStartedAt === null;

/** A page save: the server's answer from the saved position. */
function pageError(
  context: WriteContext,
  previous: Stored,
  next: Stored
): string | null {
  const { lane } = context;
  const since = lane.refreshAll ? null : previous.updatedSince;
  const position = previous.nextCursor ?? positionOf(context.request, since);
  if (!context.served.get(position)?.has(next.nextCursor)) {
    return `saved a page the server never returned from ${position}`;
  }
  if (next.nextCursor !== null) {
    return isSamePass(previous, next)
      ? null
      : 'a mid-pass page changed the pass';
  }
  if (next.updatedSince !== (previous.scanStartedAt ?? previous.updatedSince)) {
    return 'a finished pass must set the watermark to its own start';
  }
  if (lane.catchUpAfterInitialPass === true && previous.updatedSince === null) {
    return isCatchUpStart(next) ? null : 'skipped the catch-up pass';
  }
  return isCompleted(next) ? null : 'did not complete';
}

/** A pass start: the saved state with a new start and, if due, no cursor. */
function isPassStart(
  lane: SoupBackfillParams,
  previous: Stored,
  next: Stored
): boolean {
  const restarts = lane.restartOnRun === true;
  const due = restarts || previous.completed || previous.scanStartedAt === null;
  const cursor = restarts || previous.completed ? null : previous.nextCursor;
  return (
    due &&
    next.pagesFetched === (restarts ? 0 : previous.pagesFetched) &&
    next.nextCursor === cursor &&
    // A pass starts after everything already saved, so a start computed
    // before a newer save, and written late, fails here.
    parseTime(next.scanStartedAt) >
      Math.max(
        parseTime(previous.scanStartedAt),
        parseTime(previous.completedAt)
      ) &&
    next.updatedSince === previous.updatedSince &&
    next.completedAt === previous.completedAt &&
    !next.completed
  );
}

/**
 * Why `next` may not follow `previous` under one key, or null: it must be in
 * the current storage generation and be one runner step from `previous`.
 */
function writeError(
  context: WriteContext,
  previous: Stored | null,
  next: Stored
): string | null {
  if (next.storageGeneration !== context.generation) {
    if (next.storageGeneration !== null) {
      context.onLate?.(next.storageGeneration);
    }
    if (
      next.storageGeneration === null ||
      !context.lateGenerations.has(next.storageGeneration)
    ) {
      return 'saved under an older storage generation';
    }
    // Its lock kept every tab that knew of the reset off this checkpoint.
    if (previous?.storageGeneration === context.generation) {
      return 'a late write over the current generation';
    }
    // Otherwise it is one runner step in the generation the tab sampled.
    return writeError(
      {
        ...context,
        generation: next.storageGeneration,
        lateGenerations: { has: () => false },
      },
      previous,
      next
    );
  }
  if (
    previous === null ||
    previous.storageGeneration !== next.storageGeneration
  ) {
    return isFreshPass(next)
      ? null
      : 'a new generation must start a fresh pass';
  }
  if (next.pagesFetched === previous.pagesFetched + 1) {
    return pageError(context, previous, next);
  }
  return isPassStart(context.lane, previous, next)
    ? null
    : 'neither a page nor a pass start of the saved state';
}

/**
 * Two builds against one cache: an older build, either the shipped lanes or a
 * later build with one lane changed, and a newer build with more changed. The
 * server answers what a lane asks for, not its contract
 * hash. Each lane request has records of its own, one per page, in id order;
 * a record changes when the model updates it, and a request filtered by
 * `updatedAt` returns only records changed since. A cursor names the request
 * that issued it, its filter and the last record it returned.
 *
 * Every tab holds its build's coordinator leadership lock while it runs, as
 * `tab-election` does for the leader; a shipped-lane tab from before
 * checkpoint locks leads the v19 coordinator and holds nothing else. The model sees every checkpoint write
 * and checks it against the write before it under the same key:
 * - it is in the current storage generation;
 * - it starts a pass, restarts the lane for a new generation, or saves the
 *   page the server returned for the position the previous write recorded;
 * - a finished pass moves the watermark to its own start, and a lane that
 *   catches up after its first pass does so before it completes.
 * A run that stops before fetching makes no first request, but each write it
 * made was checked. After every step, every checkpoint in the current
 * generation vouches only for record versions the cache holds, and a run that
 * succeeded completed. Tabs also run whole suites (`runSoupBackfills`), alone
 * or two at once, leaving held lanes and revisiting them; when every suite of
 * a step finished, each of their lanes is completed. Storage may reset just
 * after any generation sample of a suite. Until a tab running then samples
 * again, its write under that generation is checked as a runner step in it,
 * and may not replace a checkpoint of the current one; the app then runs its
 * suites again, as it does when the cache generation changes.
 */
async function replay(
  changes: readonly LaneChange[],
  pageCounts: readonly number[],
  actions: readonly Action[],
  resumes: Resumes,
  /** A lane both builds changed alike, so the older build is not the shipped
   * one either and the lane they share is under neither's v19 key. */
  base: number | null = null
) {
  localStorage.clear();
  vi.setSystemTime(START);
  const tick = () => vi.setSystemTime(Date.now() + TICK_MS);
  let generation = 0;
  const violations: string[] = [];
  const older: readonly SoupBackfillParams[] = DEFAULT_SOUP_BACKFILL_LANES.map(
    (lane, index) =>
      index === base
        ? { ...lane, contractVersion: (lane.contractVersion ?? 0) + 10 }
        : lane
  );
  const builds = [
    older,
    older.map((lane, index) => changeLane(lane, changes[index])),
  ] as const;
  /** What the server sees a lane ask for. */
  const requestOf = (build: Build, laneIndex: number) =>
    [
      DEFAULT_SOUP_BACKFILL_LANES[laneIndex].checkpointId,
      ...(laneIndex === base ? ['base'] : []),
      ...(build === 1 && changes[laneIndex] !== 'same'
        ? [changes[laneIndex]]
        : []),
    ].join(':');
  // Only the shipped lanes can be a build from before checkpoint locks.
  const isPreLock = (build: Build, preLock: boolean) =>
    build === 0 && base === null && preLock;
  // A changed lane has one more record than the shipped one.
  const pagesOf = (build: Build, laneIndex: number) =>
    pageCounts[laneIndex] +
    (build === 1 && changes[laneIndex] !== 'same' ? 1 : 0);

  const server = new Map<string, Versions[]>();
  const recordsOf = (build: Build, laneIndex: number) => {
    const request = requestOf(build, laneIndex);
    const records =
      server.get(request) ??
      Array.from({ length: pagesOf(build, laneIndex) }, () => [
        { at: Number.NEGATIVE_INFINITY, version: 0 },
      ]);
    server.set(request, records);
    return records;
  };
  const update = (build: Build, laneIndex: number, entity: number) => {
    const records = recordsOf(build, laneIndex);
    const versions = records[entity % records.length];
    tick();
    versions.push({ at: Date.now(), version: versions.length });
    tick();
  };
  /** The record versions each storage generation's cache holds. */
  const cache = new Map<number, Map<string, number>>([[0, new Map()]]);
  const served = new Map<string, Set<string | null>>();

  /** Each checkpoint key, with the lane and request it belongs to. */
  const lanesByKey = new Map<
    string,
    { lane: SoupBackfillParams; laneIndex: number; build: Build }
  >();
  builds.forEach((lanes, build) => {
    lanes.forEach((lane, laneIndex) => {
      lanesByKey.set(soupBackfillCheckpointKey('user-1', lane), {
        lane,
        laneIndex,
        build: build as Build,
      });
    });
  });
  const read = (key: string): Stored | null => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Stored);
  };
  /** The build that saved each key's last page. */
  const pageWriter = new Map<string, Build>();
  /** The build that fetched a page whose save is due, by key. */
  const fetchedBy = new Map<string, Build>();
  const bump = (resume: Resumes extends Map<infer K, number> ? K : never) =>
    resumes.set(resume, (resumes.get(resume) ?? 0) + 1);

  /** The generations `tab` may still act on after a reset ended them. */
  const lateFor = (tab: number) => ({
    has: (stale: string) => late.get(stale)?.has(tab) ?? false,
  });
  /** The suite tab whose fiber writes, as `runSuite` provides it. */
  const writingTab = () => {
    const fiber = Fiber.getCurrent();
    if (fiber === undefined) violations.push('a checkpoint write off a fiber');
    return fiber?.getRef(TabId) ?? -1;
  };
  /** Checks `tab`'s checkpoint write against the one before it. */
  const checkWrite = (
    key: string,
    previous: Stored | null,
    next: Stored,
    tab: number
  ) => {
    const owner = lanesByKey.get(key);
    if (!owner) return;
    const error = writeError(
      {
        lane: owner.lane,
        request: requestOf(owner.build, owner.laneIndex),
        generation: `g${generation}`,
        lateGenerations: lateFor(tab),
        onLate: (stale) => {
          if (lateFor(tab).has(stale)) bump('late-write');
        },
        served,
      },
      previous,
      next
    );
    if (error) {
      violations.push(
        `${key}: ${error}: ${JSON.stringify(previous)} -> ${JSON.stringify(next)}`
      );
    }
  };
  const setItem = Storage.prototype.setItem;
  const spy = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key: string, value: string) {
      if (lanesByKey.has(key)) {
        checkWrite(key, read(key), JSON.parse(value) as Stored, writingTab());
        const by = fetchedBy.get(key);
        if (by !== undefined) pageWriter.set(key, by);
        fetchedBy.delete(key);
      }
      setItem.call(this, key, value);
    });

  const reset = () => {
    generation += 1;
    cache.set(generation, new Map());
  };
  /** Generation samples left before storage resets just after one. */
  let samplesUntilReset: number | null = null;
  /** Suite tabs running in this step. */
  const running = new Set<number>();
  /**
   * Each generation a reset ended just after a sample, with the running tabs
   * whose last sample it was: until they sample again, they may act on it.
   */
  const late = new Map<string, Set<number>>();
  /** Each running suite tab's last generation sample. */
  const lastSample = new Map<number, string>();
  /** `tab` acts on a newer sample, or writes nothing more. */
  const caughtUp = (tab: number) => {
    for (const [stale, behind] of late) {
      behind.delete(tab);
      if (behind.size === 0) late.delete(stale);
    }
  };
  /** The cache host as one tab sees it; -1 for single-lane runs. */
  const hostOf = (tab: number) => ({
    currentStorageGeneration: async () => {
      tick();
      caughtUp(tab);
      const sampled = `g${generation}`;
      lastSample.set(tab, sampled);
      if (samplesUntilReset === 0) {
        const acting = [...running].filter(
          (id) => lastSample.get(id) === sampled
        );
        late.set(sampled, new Set(acting));
        reset();
      }
      if (samplesUntilReset !== null) {
        samplesUntilReset =
          samplesUntilReset === 0 ? null : samplesUntilReset - 1;
      }
      return sampled;
    },
  });
  const host = hostOf(-1);

  /** The server's answer to a page request from `position`. */
  const serve = (build: Build, laneIndex: number, position: string) => {
    const request = requestOf(build, laneIndex);
    const [issuer, after] = position.split('|');
    const [issuedBy, filter] = issuer.split('~');
    if (issuedBy !== request) {
      violations.push(`${request} resumed a cursor of ${issuedBy}`);
    }
    const from = after === undefined ? -1 : Number(after);
    const sinceTime = filter === '-' ? null : Date.parse(filter);
    const records = recordsOf(build, laneIndex);
    const matches = (versions: Versions) =>
      sinceTime === null ||
      (versions.at(-1)?.at ?? Number.NEGATIVE_INFINITY) >= sinceTime;
    const index = records.findIndex(
      (versions, id) => id > from && matches(versions)
    );
    let nextCursor: string | null = null;
    if (index >= 0) {
      cache
        .get(generation)
        ?.set(`${request}|${index}`, records[index].at(-1)?.version ?? 0);
      const more = records.some(
        (versions, id) => id > index && matches(versions)
      );
      nextCursor = more ? `${issuer}|${index}` : null;
    }
    const answers = served.get(position) ?? new Set();
    answers.add(nextCursor);
    served.set(position, answers);
    return nextCursor;
  };

  type RunOptions = {
    end: End;
    update?: { at: number; entity: number } | null;
    resetOnFetch?: boolean;
    preLock?: boolean;
    /** Called with the count after each page the run fetches. */
    onFetched?: (count: number) => void;
    close?: AbortController;
    /** The suite tab; -1 for single-lane runs. */
    id?: number;
  };
  /** A tab's page budget and how it ends, shared by the lanes it runs. */
  type Tab = {
    id: number;
    budget: number;
    end: End;
    close: AbortController;
    fetched: number;
    ended: boolean;
    update: { at: number; entity: number } | null;
    resetOnFetch: boolean;
    onFetched?: (count: number) => void;
  };
  const openTab = (budget: number, options: RunOptions): Tab => ({
    id: options.id ?? -1,
    budget,
    end: options.end,
    close: options.close ?? new AbortController(),
    fetched: 0,
    ended: false,
    update: options.update ?? null,
    resetOnFetch: options.resetOnFetch === true,
    onFetched: options.onFetched,
  });
  /** Ends a tab at its budget: a failed fetch, or the tab closing mid-fetch. */
  const endTab = (tab: Tab, signal: AbortSignal | undefined) => {
    tab.ended = true;
    if (tab.end === 'fail') {
      return Promise.reject(new Error('the run ends here'));
    }
    tab.close.abort();
    return new Promise<never>((_resolve, reject) => {
      if (signal?.aborted) reject(new Error('the tab closed'));
      signal?.addEventListener('abort', () =>
        reject(new Error('the tab closed'))
      );
    });
  };
  /** A run's first request resumes the saved position it may, or starts a
   * pass from the saved watermark. A tab that sampled a generation just
   * before storage reset may still start from what it saved under it. */
  const checkFirstRequest = (
    build: Build,
    laneIndex: number,
    position: string,
    tab: number
  ) => {
    const lane = builds[build][laneIndex];
    const key = soupBackfillCheckpointKey('user-1', lane);
    const saved = read(key);
    const due = (current: boolean) => {
      const resumed =
        saved !== null &&
        current &&
        !saved.completed &&
        lane.restartOnRun !== true
          ? saved.nextCursor
          : null;
      const since =
        saved !== null && current && !lane.refreshAll
          ? saved.updatedSince
          : null;
      return {
        resumed,
        position: resumed ?? positionOf(requestOf(build, laneIndex), since),
      };
    };
    const savedGeneration = saved?.storageGeneration ?? null;
    const fromLate =
      savedGeneration !== null && lateFor(tab).has(savedGeneration);
    const dues = [due(savedGeneration === `g${generation}`)];
    if (fromLate) dues.push(due(true));
    const matched = dues.find((option) => option.position === position);
    if (matched === undefined) {
      violations.push(
        `${key} started at ${position} where ${dues[0].position} was due`
      );
      return;
    }
    const writer = pageWriter.get(key);
    if (
      matched.resumed === null ||
      fromLate ||
      writer === undefined ||
      writer === build
    ) {
      return;
    }
    bump(`${laneIndex}:${build === 1 ? 'forward' : 'back'}`);
  };
  /** The lane's params for one run in `tab`, with the model's page fetch. */
  const paramsOf = (
    build: Build,
    laneIndex: number,
    tab: Tab
  ): SoupBackfillParams => {
    const lane = builds[build][laneIndex];
    const request = requestOf(build, laneIndex);
    const key = soupBackfillCheckpointKey('user-1', lane);
    let first = true;
    const fetchPage: FetchPage = async (input: Input, fetchOptions) => {
      tick();
      const continuation = 'continuation' in input ? input.continuation : null;
      const since = continuation === null ? watermarkOf(input) : null;
      const position = continuation?.cursor ?? positionOf(request, since);
      if (first) checkFirstRequest(build, laneIndex, position, tab.id);
      first = false;
      if (tab.fetched === tab.budget) return endTab(tab, fetchOptions?.signal);
      tab.fetched += 1;
      const nextCursor = serve(build, laneIndex, position);
      fetchedBy.set(key, build);
      if (tab.update?.at === tab.fetched - 1) {
        update(build, laneIndex, tab.update.entity);
      }
      if (tab.resetOnFetch) {
        tab.resetOnFetch = false;
        reset();
      }
      tab.onFetched?.(tab.fetched);
      return { nextCursor };
    };
    return { ...lane, fetchPage, createFetchPage: undefined, pageDelayMs: 0 };
  };
  /**
   * Runs `effect` in a tab of `build` while it leads the build's coordinator,
   * as the elected tab does, and interrupts it when the tab closes. Undefined
   * when the tab closed before it led. A tab from before checkpoint locks
   * leads the v19 coordinator.
   */
  const asLeader = async <A>(
    build: Build,
    close: AbortController,
    effect: Effect.Effect<A, unknown>,
    preLock = false
  ) => {
    let exit: Exit.Exit<A, unknown> | undefined;
    const leadership = soupBackfillLeadershipLock(
      preLock ? V19_COORDINATOR : soupBackfillCoordinatorKey(builds[build])
    );
    try {
      await navigator.locks.request(
        leadership,
        { signal: close.signal },
        async () => {
          const fiber = Effect.runFork(effect);
          const stop = () => {
            Effect.runFork(Fiber.interrupt(fiber));
          };
          if (close.signal.aborted) stop();
          else close.signal.addEventListener('abort', stop, { once: true });
          exit = await Effect.runPromise(Fiber.await(fiber));
        }
      );
    } catch (error) {
      // Closed while waiting to lead.
      if (!close.signal.aborted) violations.push(`build ${build}: ${error}`);
    }
    return exit;
  };
  const runLane = async (
    build: Build,
    laneIndex: number,
    budget: number,
    options: RunOptions
  ) => {
    const lanes = builds[build];
    const key = soupBackfillCheckpointKey('user-1', lanes[laneIndex]);
    const tab = openTab(budget, options);
    /** The run's own last page save; another tab may write after it. */
    const last: { saved: SoupBackfillCheckpoint | null } = { saved: null };
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    // A tab from before checkpoint locks runs every lane unlocked.
    if (options.preLock) {
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
    }
    const effect = runSoupBackfill(
      'user-1',
      host,
      paramsOf(build, laneIndex, tab),
      {
        onCheckpoint: (checkpoint) => {
          last.saved = checkpoint;
        },
      }
    );
    if (locks) Object.defineProperty(navigator, 'locks', locks);
    const exit = await asLeader(
      build,
      tab.close,
      effect,
      options.preLock === true
    );
    if (exit === undefined) return;
    if (Exit.isSuccess(exit)) {
      if (
        last.saved?.completed !== true ||
        last.saved.storageGeneration !== `g${generation}`
      ) {
        violations.push(`${key} succeeded without completing`);
      }
    } else if (!tab.ended && !tab.close.signal.aborted) {
      violations.push(`${key} failed: ${String(exit.cause)}`);
    }
  };
  /**
   * Runs every lane of `build` as the leading tab `id` does; true if it
   * finished.
   */
  const runSuite = async (build: Build, budget: number | null, id: number) => {
    const tab = openTab(budget ?? Number.POSITIVE_INFINITY, {
      end: 'close',
      id,
    });
    const lanes = builds[build].map((_lane, laneIndex) =>
      paramsOf(build, laneIndex, tab)
    );
    running.add(id);
    const exit = await asLeader(
      build,
      tab.close,
      runSoupBackfills('user-1', hostOf(id), lanes).pipe(
        Effect.provideService(TabId, id)
      )
    );
    running.delete(id);
    lastSample.delete(id);
    caughtUp(id);
    if (exit === undefined) return false;
    if (Exit.isFailure(exit) && !tab.ended && !tab.close.signal.aborted) {
      violations.push(`build ${build} suite failed: ${String(exit.cause)}`);
    }
    return Exit.isSuccess(exit);
  };
  /** After suites that all finished with no reset, their lanes are done. */
  const checkFinished = (tabs: readonly Build[]) => {
    for (const build of tabs) {
      for (const lane of builds[build]) {
        const key = soupBackfillCheckpointKey('user-1', lane);
        const saved = read(key);
        if (saved?.storageGeneration !== `g${generation}` || !saved.completed) {
          violations.push(`${key} is not completed after its suite finished`);
        }
      }
    }
  };

  /** Every checkpoint vouches only for record versions the cache holds. */
  const check = () => {
    const held = cache.get(generation) ?? new Map<string, number>();
    for (const [key, { laneIndex, build }] of lanesByKey) {
      const saved = read(key);
      // A run restarts an older generation's checkpoint (checked above).
      if (saved?.storageGeneration !== `g${generation}`) continue;
      const request = requestOf(build, laneIndex);
      const watermark = parseTime(saved.updatedSince);
      let passed = -1;
      if (!saved.completed && saved.nextCursor !== null) {
        const [issuer, after] = saved.nextCursor.split('|');
        if (issuer.split('~')[0] !== request) {
          violations.push(`${request} holds a cursor of ${issuer}`);
        }
        passed = Number(after);
      }
      recordsOf(build, laneIndex).forEach((versions, id) => {
        const since =
          id <= passed
            ? Math.max(watermark, parseTime(saved.scanStartedAt))
            : watermark;
        const due = versionBefore(versions, since);
        const has = held.get(`${request}|${id}`) ?? -1;
        if (has < due) {
          violations.push(
            `${request} vouches for version ${due} of record ${id}; the cache has ${has}`
          );
        }
      });
    }
  };

  for (const action of actions) {
    await match(action)
      .with({ kind: 'run' }, ({ build, lane, pages, end, update, preLock }) =>
        runLane(build, lane, pages, {
          end,
          update,
          preLock: isPreLock(build, preLock),
        })
      )
      .with(
        { kind: 'concurrent' },
        async ({ lane, pages, ends, first, closeSecondAfter, preLock }) => {
          const second: Build = first === 0 ? 1 : 0;
          const closeSecond = new AbortController();
          const closeIfAsked = () => {
            if (closeSecondAfter !== null) closeSecond.abort();
          };
          await Promise.all([
            runLane(first, lane, pages[first], {
              end: ends[first],
              preLock: isPreLock(first, preLock),
              onFetched: (count) => {
                if (count === closeSecondAfter) closeIfAsked();
              },
            }).finally(closeIfAsked),
            runLane(second, lane, pages[second], {
              end: ends[second],
              preLock: isPreLock(second, preLock),
              close: closeSecond,
            }),
          ]);
        }
      )
      .with({ kind: 'suite' }, async ({ tabs, pages, resetAtSample }) => {
        const before = generation;
        samplesUntilReset = resetAtSample;
        const finished = await Promise.all(
          tabs.map((build, id) => runSuite(build, pages[id] ?? null, id))
        );
        samplesUntilReset = null;
        if (!finished.every(Boolean)) return;
        if (generation === before) {
          checkFinished(tabs);
          if (tabs.length === 2) bump('suite-pair');
          return;
        }
        // The app runs the suite again when the cache generation changes.
        const again = await Promise.all(
          tabs.map((build, id) => runSuite(build, null, id))
        );
        if (!again.every(Boolean)) return;
        checkFinished(tabs);
        bump('suite-after-reset');
        if (tabs.length === 2) bump('suite-pair');
      })
      .with({ kind: 'update' }, async ({ build, lane, entity }) => {
        update(build, lane, entity);
      })
      .with({ kind: 'reset' }, async () => {
        reset();
      })
      .with({ kind: 'reset-during-fetch' }, ({ build, lane }) =>
        runLane(build, lane, 9, { end: 'fail', resetOnFetch: true })
      )
      .exhaustive();
    check();
  }
  // Two finishing runs of each newer-build lane: the first completes the pass
  // in progress, the second catches what changed while it ran. The cache then
  // holds the latest version of every record, as a freshly built cache would.
  for (let laneIndex = 0; laneIndex < LANE_COUNT; laneIndex += 1) {
    await runLane(1, laneIndex, 1_000, { end: 'fail' });
    await runLane(1, laneIndex, 1_000, { end: 'fail' });
  }
  check();
  const held = cache.get(generation) ?? new Map<string, number>();
  builds[1].forEach((_lane, laneIndex) => {
    const request = requestOf(1, laneIndex);
    recordsOf(1, laneIndex).forEach((versions, id) => {
      const latest = versions.at(-1)?.version ?? 0;
      if (held.get(`${request}|${id}`) !== latest) {
        violations.push(
          `${request} finished without version ${latest} of record ${id}`
        );
      }
    });
  });
  spy.mockRestore();
  expect(violations).toEqual([]);
}

const totalResumes = (resumes: Resumes, direction: Direction) =>
  [...resumes]
    .filter(([key]) => key.endsWith(`:${direction}`))
    .reduce((sum, [, count]) => sum + count, 0);

describe('soup backfill across builds', () => {
  let restoreLocks = () => {};
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    restoreLocks = installBrowserLocks().restore;
  });
  afterEach(() => {
    restoreLocks();
    vi.useRealTimers();
  });

  it.each(
    DEFAULT_SOUP_BACKFILL_LANES.map((lane, index) => [lane.checkpointId, index])
  )(
    'resumes %s across builds both ways while another lane differs',
    async (_id, index) => {
      const changes = DEFAULT_SOUP_BACKFILL_LANES.map(
        (_lane, other): LaneChange =>
          other === (index + 1) % LANE_COUNT ? 'filter' : 'same'
      );
      const pageCounts = DEFAULT_SOUP_BACKFILL_LANES.map(() => 3);
      const resumesEveryRun =
        DEFAULT_SOUP_BACKFILL_LANES[index].restartOnRun !== true;
      const run = (build: Build): Action => ({
        kind: 'run',
        build,
        lane: index,
        pages: 1,
        end: 'fail',
        update: null,
        preLock: false,
      });
      for (const [first, second] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const resumes: Resumes = new Map();
        await replay(changes, pageCounts, [run(first), run(second)], resumes);
        const direction = second === 1 ? 'forward' : 'back';
        expect((resumes.get(`${index}:${direction}`) ?? 0) > 0).toBe(
          resumesEveryRun
        );
      }
    }
  );

  it('keeps each write one step from the last, vouches only for what the cache holds, and finishes as a fresh build', async () => {
    const resumes: Resumes = new Map();
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<LaneChange>(
            'same',
            'filter',
            'operation',
            'version',
            'recency'
          ),
          { minLength: LANE_COUNT, maxLength: LANE_COUNT }
        ),
        fc.array(fc.integer({ min: 1, max: 4 }), {
          minLength: LANE_COUNT,
          maxLength: LANE_COUNT,
        }),
        fc.array(actionArb, { minLength: 1, maxLength: 30 }),
        fc.option(laneArb, { nil: null, freq: 2 }),
        (changes, pageCounts, actions, base) =>
          replay(changes, pageCounts, actions, resumes, base)
      ),
      { numRuns: 300 }
    );
    // The cases above resume every lane both ways; this only checks that
    // generated cases reach cross-build resumes at all.
    expect(
      totalResumes(resumes, 'forward') + totalResumes(resumes, 'back')
    ).toBeGreaterThan(0);
    for (const reached of [
      'suite-pair',
      'suite-after-reset',
      'late-write',
    ] as const) {
      expect(resumes.get(reached) ?? 0, reached).toBeGreaterThan(0);
    }
  }, 120_000);
});
