import {
  SoupBackfillDocument,
  SoupMailBackfillDocument,
} from '@service-storage/graphql/generated/graphql';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import fc from 'fast-check';
import { match } from 'ts-pattern';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUP_BACKFILL_LANES,
  loadSoupBackfillCheckpoint,
  runSoupBackfill,
  type SoupBackfillParams,
} from './backfill';
import { soupBackfillCheckpointKey } from './backfill-contract';
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

/** How a newer build differs from the shipped lanes in one lane. */
type LaneChange = 'same' | 'filter' | 'operation' | 'version' | 'recency';

const LANE_COUNT = DEFAULT_SOUP_BACKFILL_LANES.length;

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

type Action =
  | { kind: 'run'; build: 0 | 1; lane: number; pages: number }
  | {
      kind: 'concurrent';
      lane: number;
      pages: readonly [number, number];
    }
  | { kind: 'reset' }
  | { kind: 'reset-during-fetch'; build: 0 | 1; lane: number };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('run' as const),
      build: fc.constantFrom(0 as const, 1 as const),
      lane: fc.nat({ max: LANE_COUNT - 1 }),
      // A run ends after this many pages, as when a tab closes or a fetch
      // fails; 9 lets every lane finish.
      pages: fc.nat({ max: 9 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('concurrent' as const),
      lane: fc.nat({ max: LANE_COUNT - 1 }),
      pages: fc.tuple(fc.nat({ max: 9 }), fc.nat({ max: 9 })),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'reset' as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('reset-during-fetch' as const),
      build: fc.constantFrom(0 as const, 1 as const),
      lane: fc.nat({ max: LANE_COUNT - 1 }),
    }),
  }
);

/** Runs that resumed a cursor the other build saved, by lane and direction:
 * `forward` is the newer build resuming the shipped one, `back` the reverse. */
type Resumes = Map<`${number}:${'forward' | 'back'}`, number>;

/** What the model last saw saved under one checkpoint key. */
type Saved = {
  generation: number;
  cursor: string | null;
  completed: boolean;
  build: 0 | 1;
  saves: number;
};

/**
 * Two builds against one cache: the shipped lanes, and a newer build with some
 * lanes changed. The server answers what a lane asks for, not its contract
 * hash: each changed lane has pages of its own, and a cursor names the lane
 * request that issued it. The model keeps its own record of every save, so it
 * knows what each run must send without asking the code under test:
 * - a run's first request resumes the cursor last saved under its key in the
 *   current storage generation, or starts a fresh pass when there is none, the
 *   pass completed, or the lane restarts every run;
 * - no run saves over a save made after its own request, as an older cursor
 *   written over newer progress would;
 * - every saved checkpoint at the current generation vouches only for pages
 *   that generation holds, as a freshly built cache's would.
 */
async function replay(
  changes: readonly LaneChange[],
  pageCounts: readonly number[],
  actions: readonly Action[],
  resumes: Resumes
) {
  localStorage.clear();
  let generation = 0;
  const hydrated = new Map<number, Set<string>>([[0, new Set()]]);
  const violations: string[] = [];
  const builds = [
    DEFAULT_SOUP_BACKFILL_LANES as readonly SoupBackfillParams[],
    DEFAULT_SOUP_BACKFILL_LANES.map((lane, index) =>
      changeLane(lane, changes[index])
    ),
  ] as const;
  /** What the server sees a lane ask for. */
  const requestOf = (build: 0 | 1, laneIndex: number) => {
    const id = DEFAULT_SOUP_BACKFILL_LANES[laneIndex].checkpointId;
    return build === 1 && changes[laneIndex] !== 'same'
      ? `${id}:${changes[laneIndex]}`
      : id;
  };
  // A changed lane returns one more page than the shipped one.
  const pagesOf = (build: 0 | 1, laneIndex: number) =>
    pageCounts[laneIndex] +
    (build === 1 && changes[laneIndex] !== 'same' ? 1 : 0);
  const saved = new Map<string, Saved>();
  const host = { currentStorageGeneration: async () => `g${generation}` };

  const runLane = async (
    build: 0 | 1,
    laneIndex: number,
    budget: number,
    { resetOnFetch = false } = {}
  ) => {
    const lane = builds[build][laneIndex];
    const request = requestOf(build, laneIndex);
    const key = soupBackfillCheckpointKey('user-1', lane);
    let fetched = 0;
    let interrupted = false;
    let savesAtRequest = 0;
    const fetchPage: FetchPage = async (input: Input) => {
      const continuation = 'continuation' in input ? input.continuation : null;
      const last = saved.get(key);
      savesAtRequest = last?.saves ?? 0;
      if (fetched === 0) {
        const expected =
          last &&
          last.generation === generation &&
          !last.completed &&
          lane.restartOnRun !== true
            ? last.cursor
            : null;
        const sent = continuation?.cursor ?? null;
        if (sent !== expected) {
          violations.push(
            `${key} sent ${sent ?? 'a fresh pass'} where ${expected ?? 'a fresh pass'} was due`
          );
        } else if (sent !== null && last && last.build !== build) {
          const direction = build === 1 ? 'forward' : 'back';
          resumes.set(
            `${laneIndex}:${direction}`,
            (resumes.get(`${laneIndex}:${direction}`) ?? 0) + 1
          );
        }
      }
      if (fetched === budget) {
        interrupted = true;
        throw new Error('the run ends here');
      }
      fetched += 1;
      let page = 0;
      if (continuation) {
        const [issuer, index] = continuation.cursor.split('|');
        if (issuer !== request) {
          violations.push(`${request} resumed a cursor of ${issuer}`);
        }
        page = Number(index);
      }
      hydrated.get(generation)?.add(`${request}|${page}`);
      if (resetOnFetch) {
        resetOnFetch = false;
        generation += 1;
        hydrated.set(generation, new Set());
      }
      const next = page + 1;
      return {
        nextCursor:
          next < pagesOf(build, laneIndex) ? `${request}|${next}` : null,
      };
    };
    const exit = await Effect.runPromiseExit(
      runSoupBackfill(
        'user-1',
        host,
        {
          ...lane,
          fetchPage,
          createFetchPage: undefined,
          pageDelayMs: 0,
        },
        {
          onCheckpoint: (checkpoint) => {
            const saves = saved.get(key)?.saves ?? 0;
            if (saves !== savesAtRequest) {
              violations.push(`${key} saved over newer progress`);
            }
            saved.set(key, {
              generation: Number(checkpoint.storageGeneration?.slice(1)),
              cursor: checkpoint.nextCursor,
              completed: checkpoint.completed,
              build,
              saves: saves + 1,
            });
          },
        }
      )
    );
    if (Exit.isFailure(exit) && !interrupted) {
      violations.push(`${key} failed: ${String(exit.cause)}`);
    }
  };

  const check = () => {
    builds.forEach((lanes, buildIndex) => {
      const build = buildIndex as 0 | 1;
      lanes.forEach((lane, laneIndex) => {
        const checkpoint = loadSoupBackfillCheckpoint('user-1', lane);
        // A run restarts an older generation's checkpoint (checked above).
        if (checkpoint.storageGeneration !== `g${generation}`) return;
        const request = requestOf(build, laneIndex);
        const held = hydrated.get(generation) ?? new Set<string>();
        let vouched = 0;
        if (checkpoint.completed) vouched = pagesOf(build, laneIndex);
        else if (checkpoint.nextCursor) {
          const [issuer, index] = checkpoint.nextCursor.split('|');
          if (issuer !== request) {
            violations.push(`${request} holds a cursor of ${issuer}`);
          }
          vouched = Number(index);
        }
        for (let page = 0; page < vouched; page += 1) {
          if (!held.has(`${request}|${page}`)) {
            violations.push(
              `${request} vouches for page ${page} the cache lacks`
            );
          }
        }
      });
    });
  };

  for (const action of actions) {
    await match(action)
      .with({ kind: 'run' }, ({ build, lane, pages }) =>
        runLane(build, lane, pages)
      )
      .with({ kind: 'concurrent' }, async ({ lane, pages }) => {
        await Promise.all([
          runLane(0, lane, pages[0]),
          runLane(1, lane, pages[1]),
        ]);
      })
      .with({ kind: 'reset' }, async () => {
        generation += 1;
        hydrated.set(generation, new Set());
      })
      .with({ kind: 'reset-during-fetch' }, ({ build, lane }) =>
        runLane(build, lane, 9, { resetOnFetch: true })
      )
      .exhaustive();
    check();
  }
  // Finishing every lane of the newer build leaves the cache holding what a
  // freshly built cache on that build would hold.
  for (let laneIndex = 0; laneIndex < LANE_COUNT; laneIndex += 1) {
    await runLane(1, laneIndex, 1_000);
  }
  check();
  builds[1].forEach((lane, laneIndex) => {
    const request = requestOf(1, laneIndex);
    const held = hydrated.get(generation) ?? new Set<string>();
    for (let page = 0; page < pagesOf(1, laneIndex); page += 1) {
      if (!held.has(`${request}|${page}`)) {
        violations.push(`${request} finished without page ${page}`);
      }
    }
    if (!loadSoupBackfillCheckpoint('user-1', lane).completed) {
      violations.push(`${request} did not finish`);
    }
  });
  expect(violations).toEqual([]);
}

const totalResumes = (resumes: Resumes, direction: 'forward' | 'back') =>
  [...resumes]
    .filter(([key]) => key.endsWith(`:${direction}`))
    .reduce((sum, [, count]) => sum + count, 0);

describe('soup backfill across builds', () => {
  let restoreLocks = () => {};
  beforeEach(() => {
    localStorage.clear();
    restoreLocks = installBrowserLocks();
  });
  afterEach(() => {
    restoreLocks();
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
      for (const [first, second] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const resumes: Resumes = new Map();
        await replay(
          changes,
          pageCounts,
          [
            { kind: 'run', build: first, lane: index, pages: 1 },
            { kind: 'run', build: second, lane: index, pages: 1 },
          ],
          resumes
        );
        const direction = second === 1 ? 'forward' : 'back';
        expect((resumes.get(`${index}:${direction}`) ?? 0) > 0).toBe(
          resumesEveryRun
        );
      }
    }
  );

  it('never resumes another contract, never saves over newer progress, and finishes as a fresh build', async () => {
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
    expect(totalResumes(resumes, 'forward')).toBeGreaterThan(0);
    expect(totalResumes(resumes, 'back')).toBeGreaterThan(0);
  });
});
