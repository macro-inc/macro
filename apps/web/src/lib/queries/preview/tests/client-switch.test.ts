import type { ItemPreviewsQuery } from '@service-storage/graphql/generated/graphql';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  availability: undefined as (() => number) | undefined,
}));

vi.mock('@core/constant/featureFlags', () => ({ LOCAL_ONLY: false }));
vi.mock('@service-storage/client', () => ({ DEFAULT_ITEM_TYPE: 'document' }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  // The real host read tracks cache availability, which changes with the client.
  getGraphqlSoupCacheHost: () => {
    fixture.availability?.();
    return undefined;
  },
  mapGraphqlProperties: (properties: unknown[]) => properties,
}));
vi.mock('@app/lib/graphql-cache', () => ({
  selectRecords: () => ({}),
  readRecordsByKeys: vi.fn(),
}));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: () => ({ isPending: false, isSuccess: false }),
  useMutationState: () => () => [],
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('../dataloader', () => ({ previewDataLoader: {} }));
vi.mock('../fetchers', () => ({
  defaultNameTransform: (item: PreviewItem) => ({ ...item }),
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));

import { useItemPreview } from '../preview';
import type { PreviewItem } from '../types';

const ID = '01a081e3-3982-70e8-8d67-4c28ed21129e';

function previewServer(name: string) {
  const data: ItemPreviewsQuery = {
    user: {
      id: 'user-1',
      soup: {
        items: [
          {
            __typename: 'GraphqlSoupDocument',
            appearance: null,
            id: ID,
            displayName: name,
            documentName: name,
            fileType: 'md',
            subType: null,
            properties: [],
            viewerPermission: {
              __typename: 'GraphqlAccessLevelPermission',
              accessLevel: 'EDIT',
            },
          },
        ],
      },
    },
  };
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ data }), {
        headers: { 'Content-Type': 'application/json' },
      })
  );
  const client = createClient({
    url: 'http://preview.test/graphql',
    exchanges: [fetchExchange],
    fetch,
    preferGetMethod: false,
  });
  return { client, fetch };
}

const disposals: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  fixture.availability = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function flushResults() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe('GraphQL preview client', () => {
  it('reads through the client a failed cache hands its readers to', async () => {
    const [availability, setAvailability] = createSignal(0);
    fixture.availability = availability;
    const retired = previewServer('Before');
    const replacement = previewServer('After');
    fixture.client = retired.client;
    const [preview] = createRoot((dispose) => {
      disposals.push(dispose);
      return useItemPreview(() => ({ id: ID, type: 'document' }));
    });
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(preview()).toMatchObject({ name: 'Before' });

    fixture.client = replacement.client;
    setAvailability(1);
    vi.advanceTimersByTime(30);
    await flushResults();

    expect(replacement.fetch).toHaveBeenCalledTimes(1);
    expect(preview()).toMatchObject({ name: 'After' });
  });
});
