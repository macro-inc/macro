import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  AUXILIARY_SOUP_BACKFILL_LANE,
  CORE_SOUP_BACKFILL_LANE,
  DEFAULT_SOUP_BACKFILL_LANES,
  SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
  type SoupBackfillParams,
} from './backfill';
import {
  soupBackfillCheckpointKey,
  soupBackfillCoordinatorKey,
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

/** Adds a filter no lane uses, which changes what the lane returns. */
const withExtraFilter = (lane: SoupBackfillParams): SoupBackfillParams => ({
  ...lane,
  input: {
    ...lane.input,
    filters: {
      ...lane.input.filters,
      teamFilter: { literal: { id: 'contract-test' } },
    } as SoupBackfillParams['input']['filters'],
  },
});

/** The same value with every object's keys in reverse order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)])
    ) as T;
  }
  return value;
}

describe('soup backfill lane contracts', () => {
  it('keeps every default lane and the coordinator on the v19 keys builds before contracts use', () => {
    for (const lane of DEFAULT_SOUP_BACKFILL_LANES) {
      expect(soupBackfillCheckpointKey('user-1', lane)).toBe(
        `graphql-soup-backfill:v19:user-1:${lane.checkpointId}`
      );
    }
    expect(soupBackfillCoordinatorKey(DEFAULT_SOUP_BACKFILL_LANES)).toBe(
      'graphql-soup-backfill:v19:coordinator'
    );
  });

  it.each(DEFAULT_SOUP_BACKFILL_LANES.map((lane) => [lane.checkpointId, lane]))(
    'restarts only %s when its input changes',
    (_id, changed) => {
      const lanes = DEFAULT_SOUP_BACKFILL_LANES.map((lane) =>
        lane === changed ? withExtraFilter(lane) : lane
      );
      const keys = lanes.map((lane) =>
        soupBackfillCheckpointKey('user-1', lane)
      );
      lanes.forEach((lane, index) => {
        const before = soupBackfillCheckpointKey(
          'user-1',
          DEFAULT_SOUP_BACKFILL_LANES[index]
        );
        if (lane.checkpointId === changed.checkpointId) {
          expect(keys[index]).not.toBe(before);
          expect(keys[index]).toMatch(
            new RegExp(`^graphql-soup-backfill:c[0-9a-z]+:user-1:${_id}$`)
          );
        } else {
          expect(keys[index]).toBe(before);
        }
      });
      expect(soupBackfillCoordinatorKey(lanes)).not.toBe(
        soupBackfillCoordinatorKey(DEFAULT_SOUP_BACKFILL_LANES)
      );
    }
  );

  it('restarts the auxiliary lane alone for the CRM contacts change that took v17 to v18', () => {
    const { crmContactFilter: _contacts, ...v17Filters } =
      AUXILIARY_SOUP_BACKFILL_LANE.input.filters ?? {};
    const v17Auxiliary = {
      ...AUXILIARY_SOUP_BACKFILL_LANE,
      input: { ...AUXILIARY_SOUP_BACKFILL_LANE.input, filters: v17Filters },
    };
    expect(soupBackfillLaneContract(v17Auxiliary)).not.toBe(
      soupBackfillLaneContract(AUXILIARY_SOUP_BACKFILL_LANE)
    );
  });

  it('ignores what changes only how a lane pages', () => {
    const contract = soupBackfillLaneContract(CORE_SOUP_BACKFILL_LANE);
    const paging: SoupBackfillParams[] = [
      {
        ...CORE_SOUP_BACKFILL_LANE,
        input: { ...CORE_SOUP_BACKFILL_LANE.input, limit: 250 },
      },
      { ...CORE_SOUP_BACKFILL_LANE, pageDelayMs: 0 },
      {
        ...CORE_SOUP_BACKFILL_LANE,
        fetchPage: async () => ({ nextCursor: null }),
      },
      {
        ...CORE_SOUP_BACKFILL_LANE,
        createFetchPage: async () => async () => ({ nextCursor: null }),
      },
      reverseKeys(CORE_SOUP_BACKFILL_LANE),
      { ...CORE_SOUP_BACKFILL_LANE, contractVersion: 0 },
    ];
    for (const lane of paging) {
      expect(soupBackfillLaneContract(lane)).toBe(contract);
    }
  });

  it('restarts a lane for each part of what a finished pass stores', () => {
    const lane = SIGNAL_EMAIL_SOUP_BACKFILL_LANE;
    const contract = soupBackfillLaneContract(lane);
    const changes: SoupBackfillParams[] = [
      { ...lane, contractVersion: 1 },
      { ...lane, emailRecency: [{ signal: true, days: 91 }] },
      { ...lane, emailRecency: undefined },
      { ...lane, refreshAll: true },
      { ...lane, restartOnRun: true },
      { ...lane, catchUpAfterInitialPass: false },
      { ...lane, input: { ...lane.input, sortMethod: 'VIEWED_UPDATED' } },
      { ...lane, input: { ...lane.input, expand: false } },
      { ...lane, input: { ...lane.input, emailView: 'INBOX' } },
      withExtraFilter(lane),
    ];
    const contracts = changes.map(soupBackfillLaneContract);
    for (const changed of contracts) expect(changed).not.toBe(contract);
    expect(new Set(contracts).size).toBe(contracts.length);
  });

  it('gives generated lanes the same contract for equal values and a new one for any change', () => {
    const json = fc.jsonValue({ maxDepth: 3 });
    const filters = fc.dictionary(fc.string({ maxLength: 8 }), json, {
      maxKeys: 6,
    });
    const laneArb = fc.record({
      checkpointId: fc.string({ minLength: 1, maxLength: 12 }),
      input: fc.record({
        limit: fc.integer({ min: 1, max: 500 }),
        expand: fc.boolean(),
        sortMethod: fc.constantFrom('VIEWED_UPDATED', 'UPDATED_AT'),
        filters,
      }),
      contractVersion: fc.option(fc.integer({ min: 0, max: 5 }), {
        nil: undefined,
      }),
      refreshAll: fc.option(fc.boolean(), { nil: undefined }),
      pageDelayMs: fc.option(fc.integer({ min: 0, max: 5000 }), {
        nil: undefined,
      }),
    }) as fc.Arbitrary<SoupBackfillParams>;

    fc.assert(
      fc.property(laneArb, fc.integer({ min: 1, max: 500 }), (lane, limit) => {
        const contract = soupBackfillLaneContract(lane);
        expect(soupBackfillLaneContract(reverseKeys(lane))).toBe(contract);
        expect(
          soupBackfillLaneContract({
            ...lane,
            input: { ...lane.input, limit },
            pageDelayMs: limit,
          })
        ).toBe(contract);
        expect(
          soupBackfillLaneContract({
            ...lane,
            contractVersion: (lane.contractVersion ?? 0) + 1,
          })
        ).not.toBe(contract);
        expect(soupBackfillLaneContract(withExtraFilter(lane))).not.toBe(
          contract
        );
      }),
      { numRuns: 500 }
    );
  });
});
