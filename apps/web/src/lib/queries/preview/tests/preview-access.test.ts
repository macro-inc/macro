import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Client, createClient, fetchExchange } from '@urql/core';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  allowed: (): boolean => false,
  load: vi.fn(),
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => fixture.allowed(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  getGraphqlSoupCacheHost: () => undefined,
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

import { refreshActiveGraphqlPreviewQueries } from '../active-queries';
import { useItemRawName } from '../preview';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('loads only the own-thread label while CRM access is denied', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  cleanups.push(() => client.clear());
  const [allowed, setAllowed] = createSignal(false);
  fixture.allowed = allowed;
  fixture.load.mockResolvedValue({
    id: 'contact',
    type: 'crm_contact',
    access: 'no_access',
    loading: false,
  });
  const requests: unknown[] = [];
  fixture.client = createClient({
    url: 'http://preview.test/graphql',
    exchanges: [fetchExchange],
    preferGetMethod: false,
    fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)).variables);
      return Response.json({
        data: { user: { id: 'viewer', soup: { items: [] } } },
      });
    },
  });
  createRoot((dispose) => {
    cleanups.push(dispose);
    createComponent(QueryClientProvider, {
      client,
      get children() {
        useItemRawName(() => ({ id: 'company', type: 'crm_company' }));
        useItemRawName(() => ({ id: 'contact', type: 'crm_contact' }));
        useItemRawName(() => ({ id: 'thread', type: 'email' }));
        return undefined;
      },
    });
  });
  await vi.advanceTimersByTimeAsync(30);
  await refreshActiveGraphqlPreviewQueries();
  expect(fixture.load).not.toHaveBeenCalledWith({
    id: 'contact',
    type: 'crm_contact',
  });
  expect(fixture.load).not.toHaveBeenCalledWith({
    id: 'company',
    type: 'crm_company',
  });
  expect(JSON.stringify(requests)).toContain('thread');
  expect(JSON.stringify(requests)).not.toContain('company');

  setAllowed(true);
  await vi.advanceTimersByTimeAsync(30);
  expect(fixture.load).toHaveBeenCalledWith({
    id: 'contact',
    type: 'crm_contact',
  });
  expect(JSON.stringify(requests)).toContain('company');
});
