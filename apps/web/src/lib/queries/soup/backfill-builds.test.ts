import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUP_BACKFILL_LANES,
  loadSoupBackfillCheckpoint,
  runSoupBackfill,
  type SoupBackfillParams,
} from './backfill';
import {
  soupBackfillCheckpointKey,
  soupBackfillLaneContract,
} from './backfill-contract';

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
type LaneChange = 'same' | 'filter' | 'version' | 'recency';

const LANE_COUNT = DEFAULT_SOUP_BACKFILL_LANES.length;

function changeLane(
  lane: SoupBackfillParams,
  change: LaneChange
): SoupBackfillParams {
  switch (change) {
    case 'same':
      return lane;
    case 'filter':
      return {
        ...lane,
        input: {
          ...lane.input,
          filters: {
            ...lane.input.filters,
            teamFilter: { literal: { id: 'newer-build' } },
          } as SoupBackfillParams['input']['filters'],
        },
      };
    case 'version':
      return { ...lane, contractVersion: (lane.contractVersion ?? 0) + 1 };
    case 'recency':
      return { ...lane, emailRecency: [{ signal: false, days: 7 }] };
  }
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

/**
 * Two builds against one cache: the shipped lanes, and a newer build whose
 * lanes differ in some contracts. Each contract has its own server pages, and a
 * cursor names the contract that issued it, so a runner that resumes another
 * contract's cursor is caught. After every action, each saved checkpoint at
 * the current storage generation must vouch only for pages that generation
 * holds, as a freshly built cache's would.
 */
async function replay(
  changes: readonly LaneChange[],
  pageCounts: readonly number[],
  actions: readonly Action[],
  stats: { crossBuildResumes: number }
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
  // A changed lane returns one more page than the shipped one.
  const pageCount = new Map<string, number>();
  builds.forEach((build, buildIndex) =>
    build.forEach((lane, laneIndex) =>
      pageCount.set(
        soupBackfillLaneContract(lane),
        pageCounts[laneIndex] +
          (buildIndex === 1 && changes[laneIndex] !== 'same' ? 1 : 0)
      )
    )
  );
  const pagesOf = (contract: string) => pageCount.get(contract) ?? 0;
  const lastSaver = new Map<string, 0 | 1>();
  const host = { currentStorageGeneration: async () => `g${generation}` };

  const runLane = async (
    build: 0 | 1,
    laneIndex: number,
    budget: number,
    { resetOnFetch = false, checkResume = true } = {}
  ) => {
    const lane = builds[build][laneIndex];
    const contract = soupBackfillLaneContract(lane);
    const key = soupBackfillCheckpointKey('user-1', lane);
    const before = loadSoupBackfillCheckpoint('user-1', lane);
    // Two runners started together each resume whatever the other saved
    // last, so only a runner alone must resume the cursor seen before it.
    const expectResume =
      checkResume &&
      before.storageGeneration === `g${generation}` &&
      before.nextCursor !== null &&
      lane.restartOnRun !== true;
    let fetched = 0;
    let interrupted = false;
    const fetchPage: FetchPage = async (input: Input) => {
      if (fetched === budget) {
        interrupted = true;
        throw new Error('the run ends here');
      }
      const continuation = 'continuation' in input ? input.continuation : null;
      if (fetched === 0 && expectResume) {
        if (continuation?.cursor !== before.nextCursor) {
          violations.push(`${key} restarted instead of resuming`);
        } else if (lastSaver.get(key) !== build) {
          stats.crossBuildResumes += 1;
        }
      }
      fetched += 1;
      let page = 0;
      if (continuation) {
        const [issuer, index] = continuation.cursor.split('|');
        if (issuer !== contract) {
          violations.push(`${key} resumed a cursor of contract ${issuer}`);
        }
        page = Number(index);
      }
      hydrated.get(generation)?.add(`${contract}|${page}`);
      if (resetOnFetch) {
        resetOnFetch = false;
        generation += 1;
        hydrated.set(generation, new Set());
      }
      const next = page + 1;
      return {
        nextCursor: next < pagesOf(contract) ? `${contract}|${next}` : null,
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
        () => lastSaver.set(key, build)
      )
    );
    if (Exit.isFailure(exit) && !interrupted) {
      violations.push(`${key} failed: ${String(exit.cause)}`);
    }
  };

  const check = () => {
    for (const build of builds) {
      build.forEach((lane) => {
        const checkpoint = loadSoupBackfillCheckpoint('user-1', lane);
        if (checkpoint.storageGeneration !== `g${generation}`) return;
        const contract = soupBackfillLaneContract(lane);
        const held = hydrated.get(generation) ?? new Set<string>();
        let vouched = 0;
        if (checkpoint.completed) vouched = pagesOf(contract);
        else if (checkpoint.nextCursor) {
          const [issuer, index] = checkpoint.nextCursor.split('|');
          if (issuer !== contract) {
            violations.push(`${lane.checkpointId} holds a foreign cursor`);
          }
          vouched = Number(index);
        }
        for (let page = 0; page < vouched; page += 1) {
          if (!held.has(`${contract}|${page}`)) {
            violations.push(
              `${lane.checkpointId} vouches for page ${page} the cache lacks`
            );
          }
        }
      });
    }
  };

  for (const action of actions) {
    switch (action.kind) {
      case 'run':
        await runLane(action.build, action.lane, action.pages);
        break;
      case 'concurrent':
        await Promise.all([
          runLane(0, action.lane, action.pages[0], { checkResume: false }),
          runLane(1, action.lane, action.pages[1], { checkResume: false }),
        ]);
        break;
      case 'reset':
        generation += 1;
        hydrated.set(generation, new Set());
        break;
      case 'reset-during-fetch':
        await runLane(action.build, action.lane, 9, { resetOnFetch: true });
        break;
    }
    check();
  }
  // Finishing every lane of the newer build leaves the cache holding what a
  // freshly built cache on that build would hold.
  for (let laneIndex = 0; laneIndex < LANE_COUNT; laneIndex += 1) {
    await runLane(1, laneIndex, 1_000);
  }
  check();
  builds[1].forEach((lane) => {
    const contract = soupBackfillLaneContract(lane);
    const held = hydrated.get(generation) ?? new Set<string>();
    for (let page = 0; page < pagesOf(contract); page += 1) {
      if (!held.has(`${contract}|${page}`)) {
        violations.push(`${lane.checkpointId} finished without page ${page}`);
      }
    }
    expect(loadSoupBackfillCheckpoint('user-1', lane).completed).toBe(true);
  });
  expect(violations).toEqual([]);
}

describe('soup backfill across builds', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('never resumes another contract, resumes unchanged lanes across builds, and finishes as a fresh build', async () => {
    const stats = { crossBuildResumes: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<LaneChange>('same', 'filter', 'version', 'recency'),
          { minLength: LANE_COUNT, maxLength: LANE_COUNT }
        ),
        fc.array(fc.integer({ min: 1, max: 4 }), {
          minLength: LANE_COUNT,
          maxLength: LANE_COUNT,
        }),
        fc.array(actionArb, { minLength: 1, maxLength: 30 }),
        (changes, pageCounts, actions) =>
          replay(changes, pageCounts, actions, stats)
      ),
      { numRuns: 300 }
    );
    expect(stats.crossBuildResumes).toBeGreaterThan(0);
  });
});
