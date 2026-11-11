import { SoupBackfillDocument } from '@service-storage/graphql/generated/graphql';
import * as Effect from 'effect/Effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUXILIARY_SOUP_BACKFILL_LANE,
  loadSoupBackfillCheckpoint,
  runSoupBackfill,
} from './backfill';

const graphqlMocks = vi.hoisted(() => ({
  hydrateGraphqlSoup: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: graphqlMocks.hydrateGraphqlSoup,
}));

describe('CRM contact backfill', () => {
  beforeEach(() => {
    localStorage.clear();
    graphqlMocks.hydrateGraphqlSoup.mockReset();
  });

  it.each([false, true])(
    'hydrates contacts from the beginning with an old checkpoint (completed=%s)',
    async (completed) => {
      localStorage.setItem(
        'graphql-soup-backfill:v17:user-1:auxiliary-entities',
        JSON.stringify({
          userId: 'user-1',
          storageGeneration: 'storage-1',
          nextCursor: completed ? null : 'cursor-without-contacts',
          pagesFetched: 12,
          completed,
          scanStartedAt: completed ? null : '2026-09-01T00:00:00.000Z',
          updatedSince: completed ? '2026-09-01T00:00:00.000Z' : null,
          completedAt: completed ? '2026-09-02T00:00:00.000Z' : null,
        })
      );
      const host = {
        currentStorageGeneration: async () => 'storage-1',
      };
      graphqlMocks.hydrateGraphqlSoup
        .mockResolvedValueOnce({ nextCursor: 'contacts-page-2' })
        .mockResolvedValue({ nextCursor: null });

      await Effect.runPromise(
        runSoupBackfill('user-1', host, {
          ...AUXILIARY_SOUP_BACKFILL_LANE,
          pageDelayMs: 0,
        })
      );

      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenNthCalledWith(
        1,
        SoupBackfillDocument,
        {
          input: {
            initial: expect.objectContaining({
              filters: expect.objectContaining({
                crmContactFilter: { literal: { include: true } },
              }),
            }),
          },
        },
        { signal: expect.any(AbortSignal) }
      );
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenNthCalledWith(
        2,
        SoupBackfillDocument,
        {
          input: {
            continuation: {
              cursor: 'contacts-page-2',
              expand: true,
              emailView: 'ALL',
            },
          },
        },
        { signal: expect.any(AbortSignal) }
      );
      expect(
        loadSoupBackfillCheckpoint('user-1', 'auxiliary-entities')
      ).toMatchObject({
        pagesFetched: 2,
        nextCursor: null,
        completed: true,
        storageGeneration: 'storage-1',
      });

      // Contacts have no updatedAt filter; subsequent passes still hydrate
      // their full corpus, including changes to older contacts.
      await Effect.runPromise(
        runSoupBackfill('user-1', host, AUXILIARY_SOUP_BACKFILL_LANE)
      );
      expect(graphqlMocks.hydrateGraphqlSoup.mock.calls[2]?.[1]).toMatchObject({
        input: {
          initial: {
            filters: { crmContactFilter: { literal: { include: true } } },
          },
        },
      });
    }
  );
});
