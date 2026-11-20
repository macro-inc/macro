import { ThrownResultError } from '@core/util/result';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PreviewItem } from '../types';

const fetchPreviewBatch = vi.hoisted(() => vi.fn());
const graphqlItem = vi.hoisted(() => ({ value: false }));

vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => true,
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  LOCAL_ONLY: false,
}));

vi.mock('../../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

vi.mock('../fetchers', () => ({
  defaultNameTransform: (value: unknown) => value,
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: (...args: unknown[]) => fetchPreviewBatch(...args),
}));

vi.mock('../graphql', () => ({
  canWriteGraphqlPreviewCache: () => false,
  createGraphqlItemPreviewQuery: vi.fn(),
  getGraphqlItemPreview: async () => undefined,
  isGraphqlPreviewItem: () => graphqlItem.value,
  setGraphqlPreviewFileType: vi.fn(),
  setGraphqlPreviewName: vi.fn(),
  setGraphqlPreviewOnCreate: vi.fn(),
}));

const { queryClient } = await import('../../client');
const { previewKeys } = await import('../keys');
const { getItemPreview } = await import('../preview');

const COMPANY = '019a0000-0000-7000-8000-000000000001';
const UNAVAILABLE = [{ code: 'HTTP_ERROR', message: 'unavailable' }];

const company: PreviewItem = {
  id: COMPANY,
  type: 'crm_company',
  loading: false,
  access: 'access',
  rawName: 'Acme',
  name: 'Acme',
};

beforeEach(() => {
  fetchPreviewBatch.mockReset();
  queryClient.clear();
  fetchPreviewBatch
    .mockResolvedValueOnce({
      previews: new Map(),
      failed: new Map([[COMPANY, UNAVAILABLE]]),
    })
    .mockResolvedValueOnce({
      previews: new Map([[COMPANY, company]]),
      failed: new Map(),
    });
});

it('caches no answer for a chip whose request failed, and asks again on the next read', async () => {
  graphqlItem.value = false;

  await expect(
    getItemPreview({ id: COMPANY, type: 'crm_company' })
  ).rejects.toBeInstanceOf(ThrownResultError);
  expect(
    queryClient.getQueryData(previewKeys.item(COMPANY).queryKey)
  ).toBeUndefined();

  expect(await getItemPreview({ id: COMPANY, type: 'crm_company' })).toEqual(
    company
  );
  expect(fetchPreviewBatch).toHaveBeenCalledTimes(2);
});

it('throws for a failed request on the GraphQL fallback, rather than answering "No Access"', async () => {
  graphqlItem.value = true;

  await expect(
    getItemPreview({ id: COMPANY, type: 'crm_company' })
  ).rejects.toBeInstanceOf(ThrownResultError);
  expect(await getItemPreview({ id: COMPANY, type: 'crm_company' })).toEqual(
    company
  );
});
