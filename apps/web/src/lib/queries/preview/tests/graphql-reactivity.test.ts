import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { ItemPreviewsQuery } from '@service-storage/graphql/generated/graphql';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: undefined as Client | undefined }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
  LOCAL_ONLY: false,
}));
vi.mock('@service-storage/client', () => ({ DEFAULT_ITEM_TYPE: 'document' }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  getGraphqlSoupCacheHost: () => undefined,
  mapGraphqlProperties: (properties: unknown[]) => properties,
}));
vi.mock('@app/lib/graphql-cache', () => ({
  selectRecords: () => ({}),
  readRecordsByKeys: vi.fn(),
}));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: () => ({ isPending: false, isSuccess: false }),
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('../dataloader', () => ({ previewDataLoader: {} }));
vi.mock('../fetchers', () => ({
  // The real transform returns a new object, even when the name is unchanged.
  defaultNameTransform: (item: PreviewItem) => ({ ...item }),
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));

import { refreshActiveGraphqlPreviewQueries } from '../active-queries';
import { useItemPreview } from '../preview';
import type { PreviewItem } from '../types';

const disposals: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Bound the flush so a regressing feedback loop fails instead of starving a timer.
async function flushResults() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe('GraphQL preview hover reactivity', () => {
  it('shares a rich batch with the popup and stays settled across live updates', async () => {
    const id = '01a081e3-3982-70e8-8d67-4c28ed21129e';
    const document: Extract<
      ItemPreviewsQuery['user']['soup']['items'][number],
      { __typename: 'GraphqlSoupDocument' }
    > = {
      __typename: 'GraphqlSoupDocument',
      id,
      displayName: 'Roadmap',
      documentName: 'Roadmap',
      fileType: 'md',
      subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
      properties: [],
      viewerPermission: {
        __typename: 'GraphqlAccessLevelPermission',
        accessLevel: 'EDIT',
      },
    };
    const data: ItemPreviewsQuery = {
      user: { id: 'user-1', soup: { items: [document] } },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data }), {
          headers: { 'Content-Type': 'application/json' },
        })
    );
    let cachedData: unknown;
    // Only the host's storage boundary is faked; retain the real async cache
    // exchange, urql client, Solid query bridge, and preview facade.
    const host = {
      clientId: 'preview-test',
      onOpsAffected: () => () => {},
      claimNextMutation: async () => undefined,
      readQuery: async () =>
        cachedData
          ? { kind: 'hit', data: structuredClone(cachedData) }
          : { kind: 'miss' },
      writeQuery: async (args) => {
        cachedData = structuredClone(args.data);
        return {
          revision: INITIAL_CACHE_REVISION,
          revisionAdvanced: false,
          affectedOps: [],
          changed: [],
          reset: false,
        };
      },
      teardown: async () => {},
    } satisfies Pick<
      CacheHost,
      | 'clientId'
      | 'onOpsAffected'
      | 'claimNextMutation'
      | 'readQuery'
      | 'writeQuery'
      | 'teardown'
    >;
    fixture.client = createClient({
      url: 'http://preview.test/graphql',
      exchanges: [
        normalizedCacheExchange(host as unknown as CacheHost),
        fetchExchange,
      ],
      fetch,
      preferGetMethod: false,
    });
    const executeQuery = vi.spyOn(fixture.client, 'executeQuery');
    const [parent, parentControls] = createRoot((dispose) => {
      disposals.push(dispose);
      return useItemPreview(() => ({ id, type: 'document' }));
    });
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(parent()).toMatchObject({ id, name: 'Roadmap', loading: false });
    expect(parentControls.documentProperties()).toMatchObject({
      properties: [],
      canEdit: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      operationName: 'ItemPreviews',
    });

    const [popup, popupControls] = createRoot((dispose) => {
      disposals.push(dispose);
      // ItemPreview's inline documentInfo depends on the parent's preview
      // object; DocumentPreviewContent derives another ItemEntity from it.
      const documentInfo = () => ({ id: parent().id, type: 'md' });
      return useItemPreview(() => ({
        id: documentInfo().id,
        type: 'document',
      }));
    });
    await flushResults();
    expect(popup()).toMatchObject({ id, name: 'Roadmap', loading: false });
    expect(popupControls.documentProperties()).toMatchObject({
      properties: [],
      canEdit: true,
    });
    vi.advanceTimersByTime(90);
    await flushResults();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledTimes(1);

    // Both consumers must see refreshed task metadata without releasing and
    // reacquiring their batch when the parent passes down a new preview object.
    document.displayName = 'Renamed';
    document.viewerPermission = {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'VIEW',
    };
    await refreshActiveGraphqlPreviewQueries(id);
    expect(parent()).toMatchObject({ name: 'Renamed', loading: false });
    expect(popup()).toMatchObject({ name: 'Renamed', loading: false });
    expect(parentControls.documentProperties()).toMatchObject({
      canEdit: false,
    });
    expect(popupControls.documentProperties()).toMatchObject({
      canEdit: false,
    });
    vi.advanceTimersByTime(90);
    await flushResults();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });
});
