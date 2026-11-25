import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const MERGED = '01a21080-0a4e-7a4d-a846-8ac4cec5a8f8';

const fixture = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  cached: [] as Array<{ recordKey: string; record: unknown }>,
  load: vi.fn(),
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => true,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  getGraphqlSoupCacheHost: () => ({
    readRecordsByKeys: async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: fixture.cached,
    }),
  }),
  mapGraphqlProperties: (properties: unknown[]) => properties,
}));
vi.mock('../dataloader', () => ({
  previewDataLoader: { load: fixture.load },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('../fetchers', () => ({
  defaultNameTransform: (item: unknown) => item,
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));

import { useItemPreview } from '../preview';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function preview(
  id: string,
  type: 'crm_company' | 'document',
  requests: string[],
  offline = false,
  errors?: unknown[]
) {
  const client = new QueryClient();
  cleanups.push(() => client.clear());
  fixture.client = createClient({
    url: 'http://preview.test/graphql',
    exchanges: [fetchExchange],
    preferGetMethod: false,
    fetch: async (_url, init) => {
      requests.push(String(init?.body));
      if (offline) throw new TypeError('Failed to fetch');
      return Response.json({
        data: { user: { id: 'viewer', soup: { items: [] } } },
        ...(errors ? { errors } : {}),
      });
    },
  });
  return createRoot((dispose) => {
    cleanups.push(dispose);
    let shown!: ReturnType<typeof useItemPreview>[0];
    createComponent(QueryClientProvider, {
      client,
      get children() {
        [shown] = useItemPreview(() => ({ id, type }));
        return undefined;
      },
    });
    return shown;
  });
}

function cachedOldCompany() {
  fixture.cached = [
    {
      recordKey: `GraphqlSoupCrmCompany:${MERGED}`,
      record: {
        __typename: 'GraphqlSoupCrmCompany',
        id: MERGED,
        displayName: 'Old Co',
        companyName: 'Old Co',
        domains: ['old.example.com'],
      },
    },
  ];
}

it("names a merged company's chip after the company that stays, not its cached title", async () => {
  vi.useFakeTimers();
  cachedOldCompany();
  fixture.load.mockResolvedValue({
    id: MERGED,
    type: 'crm_company',
    access: 'access',
    loading: false,
    rawName: 'Kept Co',
    name: 'Kept Co',
  });
  const requests: string[] = [];
  const shown = preview(MERGED, 'crm_company', requests);

  await vi.advanceTimersByTimeAsync(30);
  expect(requests.join()).toContain(MERGED);
  expect(fixture.load).toHaveBeenCalledWith({
    id: MERGED,
    type: 'crm_company',
  });
  expect(shown()).toMatchObject({ name: 'Kept Co' });
});

it('keeps a cached document title when the server answers without it', async () => {
  vi.useFakeTimers();
  const id = '01a21080-0b8d-75a6-aaae-7bb34542cae6';
  fixture.cached = [
    {
      recordKey: `GraphqlSoupDocument:${id}`,
      record: {
        __typename: 'GraphqlSoupDocument',
        id,
        displayName: 'Roadmap',
        documentName: 'Roadmap',
        fileType: 'md',
        subType: null,
        appearance: null,
      },
    },
  ];
  fixture.load.mockReset();
  const shown = preview(id, 'document', []);

  await vi.advanceTimersByTimeAsync(30);
  expect(fixture.load).not.toHaveBeenCalled();
  expect(shown()).toMatchObject({ name: 'Roadmap' });
});

it("keeps a company chip's cached title when the read fails offline", async () => {
  vi.useFakeTimers();
  cachedOldCompany();
  fixture.load.mockReset();
  const shown = preview(MERGED, 'crm_company', [], true);

  await vi.advanceTimersByTimeAsync(30);
  expect(fixture.load).not.toHaveBeenCalled();
  expect(shown()).toMatchObject({ name: 'Old Co' });
});

it("drops a merged company's cached title when the answer carries another item's error", async () => {
  vi.useFakeTimers();
  cachedOldCompany();
  fixture.load.mockResolvedValue({
    id: MERGED,
    type: 'crm_company',
    access: 'access',
    loading: false,
    rawName: 'Kept Co',
    name: 'Kept Co',
  });
  const shown = preview(MERGED, 'crm_company', [], false, [
    { message: 'another item failed', path: ['user', 'soup', 'items', 0] },
  ]);

  await vi.advanceTimersByTimeAsync(30);
  expect(fixture.load).toHaveBeenCalledWith({
    id: MERGED,
    type: 'crm_company',
  });
  expect(shown()).toMatchObject({ name: 'Kept Co' });
});
