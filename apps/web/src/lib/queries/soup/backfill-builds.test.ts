import {
  SoupBackfillDocument,
  SoupMailBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import fc from 'fast-check';
import { match } from 'ts-pattern';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUP_BACKFILL_LANES,
  runSoupBackfill,
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
/** Every model step moves the clock on, so no two events share a time. */
const TICK_MS = 1000;

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

/** Runs that resumed a cursor the other build saved, by lane and direction:
 * `forward` is the newer build resuming the shipped one, `back` the reverse. */
type Resumes = Map<`${number}:${Direction}`, number>;

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
  /** Answers the server gave, by the position a request started from. */
  served: ReadonlyMap<string, ReadonlySet<string | null>>;
};

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
    next.scanStartedAt !== null &&
    next.scanStartedAt !== previous.scanStartedAt &&
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
    return 'saved under an older storage generation';
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

const parseTime = (iso: string | null) =>
  iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso);

/**
 * Two builds against one cache: the shipped lanes, and a newer build with some
 * lanes changed. The server answers what a lane asks for, not its contract
 * hash. Each lane request has records of its own, one per page, in id order;
 * a record changes when the model updates it, and a request filtered by
 * `updatedAt` returns only records changed since. A cursor names the request
 * that issued it, its filter and the last record it returned.
 *
 * Every tab holds its build's coordinator leadership lock while it runs, as
 * `tab-election` does for the leader; a shipped-lane tab from before
 * checkpoint locks holds nothing else. The model sees every checkpoint write
 * and checks it against the write before it under the same key:
 * - it is in the current storage generation;
 * - it starts a pass, restarts the lane for a new generation, or saves the
 *   page the server returned for the position the previous write recorded;
 * - a finished pass moves the watermark to its own start, and a lane that
 *   catches up after its first pass does so before it completes.
 * After every step, every checkpoint in the current generation vouches only
 * for record versions the cache holds, and a run that succeeded completed.
 */
async function replay(
  changes: readonly LaneChange[],
  pageCounts: readonly number[],
  actions: readonly Action[],
  resumes: Resumes
) {
  localStorage.clear();
  vi.setSystemTime(START);
  const tick = () => vi.setSystemTime(Date.now() + TICK_MS);
  let generation = 0;
  const violations: string[] = [];
  const builds = [
    DEFAULT_SOUP_BACKFILL_LANES as readonly SoupBackfillParams[],
    DEFAULT_SOUP_BACKFILL_LANES.map((lane, index) =>
      changeLane(lane, changes[index])
    ),
  ] as const;
  /** What the server sees a lane ask for. */
  const requestOf = (build: Build, laneIndex: number) => {
    const id = DEFAULT_SOUP_BACKFILL_LANES[laneIndex].checkpointId;
    return build === 1 && changes[laneIndex] !== 'same'
      ? `${id}:${changes[laneIndex]}`
      : id;
  };
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
  const pageWriter = new Map<string, Build>();
  const bump = (resume: `${number}:${Direction}`) =>
    resumes.set(resume, (resumes.get(resume) ?? 0) + 1);

  /** Checks a checkpoint write against the one before it (see `replay`). */
  const checkWrite = (key: string, previous: Stored | null, next: Stored) => {
    const owner = lanesByKey.get(key);
    if (!owner) return;
    const error = writeError(
      {
        lane: owner.lane,
        request: requestOf(owner.build, owner.laneIndex),
        generation: `g${generation}`,
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
        checkWrite(key, read(key), JSON.parse(value) as Stored);
      }
      setItem.call(this, key, value);
    });

  const host = {
    currentStorageGeneration: async () => {
      tick();
      return `g${generation}`;
    },
  };

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
  };
  const runLane = async (
    build: Build,
    laneIndex: number,
    budget: number,
    options: RunOptions
  ) => {
    const lanes = builds[build];
    const lane = lanes[laneIndex];
    const request = requestOf(build, laneIndex);
    const key = soupBackfillCheckpointKey('user-1', lane);
    const close = options.close ?? new AbortController();
    let resetOnFetch = options.resetOnFetch === true;
    let fetched = 0;
    let ended = false;
    /** A run's first request resumes the saved position it may, or starts
     * a pass from the saved watermark. */
    const checkFirstRequest = (position: string) => {
      const saved = read(key);
      const current = saved?.storageGeneration === `g${generation}`;
      const resumed =
        current && !saved.completed && lane.restartOnRun !== true
          ? saved.nextCursor
          : null;
      const since = current && !lane.refreshAll ? saved.updatedSince : null;
      const expected = resumed ?? positionOf(request, since);
      if (position !== expected) {
        violations.push(
          `${key} started at ${position} where ${expected} was due`
        );
        return;
      }
      const writer = pageWriter.get(key);
      if (resumed === null || writer === undefined || writer === build) return;
      bump(`${laneIndex}:${build === 1 ? 'forward' : 'back'}`);
    };
    const fetchPage: FetchPage = async (input: Input, fetchOptions) => {
      tick();
      const continuation = 'continuation' in input ? input.continuation : null;
      const since = continuation === null ? watermarkOf(input) : null;
      const position = continuation?.cursor ?? positionOf(request, since);
      if (fetched === 0) checkFirstRequest(position);
      if (fetched === budget) {
        ended = true;
        if (options.end === 'fail') throw new Error('the run ends here');
        close.abort();
        return new Promise((_resolve, reject) => {
          const signal = fetchOptions?.signal;
          if (signal?.aborted) reject(new Error('the tab closed'));
          signal?.addEventListener('abort', () =>
            reject(new Error('the tab closed'))
          );
        });
      }
      fetched += 1;
      const nextCursor = serve(build, laneIndex, position);
      if (options.update && options.update.at === fetched - 1) {
        update(build, laneIndex, options.update.entity);
      }
      if (resetOnFetch) {
        resetOnFetch = false;
        generation += 1;
        cache.set(generation, new Map());
      }
      options.onFetched?.(fetched);
      return { nextCursor };
    };
    const params = {
      ...lane,
      fetchPage,
      createFetchPage: undefined,
      pageDelayMs: 0,
    };
    const onCheckpoint = () => {
      pageWriter.set(key, build);
    };
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    // A tab from before checkpoint locks runs every lane unlocked.
    if (options.preLock) {
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
    }
    const effect = runSoupBackfill('user-1', host, params, {
      lanes,
      onCheckpoint,
    });
    if (locks) Object.defineProperty(navigator, 'locks', locks);
    let exit: Exit.Exit<boolean, unknown> | undefined;
    const leadership = soupBackfillLeadershipLock(
      soupBackfillCoordinatorKey(lanes)
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
      if (!close.signal.aborted) violations.push(`${key}: ${String(error)}`);
    }
    if (exit === undefined) return;
    if (Exit.isSuccess(exit)) {
      const saved = read(key);
      if (saved?.storageGeneration !== `g${generation}` || !saved.completed) {
        violations.push(`${key} succeeded without completing`);
      }
    } else if (!ended && !close.signal.aborted) {
      violations.push(`${key} failed: ${String(exit.cause)}`);
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
          preLock: build === 0 && preLock,
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
              preLock: first === 0 && preLock,
              onFetched: (count) => {
                if (count === closeSecondAfter) closeIfAsked();
              },
            }).finally(closeIfAsked),
            runLane(second, lane, pages[second], {
              end: ends[second],
              preLock: second === 0 && preLock,
              close: closeSecond,
            }),
          ]);
        }
      )
      .with({ kind: 'update' }, async ({ build, lane, entity }) => {
        update(build, lane, entity);
      })
      .with({ kind: 'reset' }, async () => {
        generation += 1;
        cache.set(generation, new Map());
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
        (changes, pageCounts, actions) =>
          replay(changes, pageCounts, actions, resumes)
      ),
      { numRuns: 300 }
    );
    // The cases above resume every lane both ways; this only checks that
    // generated cases reach cross-build resumes at all.
    expect(
      totalResumes(resumes, 'forward') + totalResumes(resumes, 'back')
    ).toBeGreaterThan(0);
  }, 120_000);
});
