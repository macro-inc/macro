import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryOptions = vi.hoisted(() => [] as Array<() => unknown>);
const setQueryDataMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const createGraphqlItemPreviewQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => true,
  LOCAL_ONLY: false,
}));

vi.mock('@tanstack/solid-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../client', () => ({
  queryClient: {
    fetchQuery: vi.fn(),
    getQueryData: vi.fn(),
    invalidateQueries: invalidateQueriesMock,
    setQueryData: setQueryDataMock,
  },
}));

vi.mock('../dataloader', () => ({
  previewDataLoader: { load: vi.fn() },
}));

vi.mock('../fetchers', () => ({
  defaultNameTransform: (value: unknown) => value,
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));

vi.mock('../graphql', () => ({
  createGraphqlItemPreviewQuery: createGraphqlItemPreviewQueryMock,
  getGraphqlItemPreview: vi.fn(),
  isGraphqlPreviewItem: () => true,
}));

const {
  invalidatePreview,
  setPreviewFileType,
  setPreviewName,
  useItemPreview,
} = await import('../preview');

const preview = {
  id: 'doc-1',
  type: 'document',
  access: 'access',
  loading: false,
  rawName: 'Document',
  name: 'Document',
} as const;

describe('preview transport facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryOptions.length = 0;
    useQueryMock.mockImplementation((options: () => unknown) => {
      useQueryOptions.push(options);
      return { isLoading: false, isSuccess: false };
    });
    createGraphqlItemPreviewQueryMock.mockReturnValue({
      data: () => preview,
      error: () => null,
      isLoading: () => false,
      isFetching: () => false,
      isEnabled: () => true,
      shouldFallback: () => false,
      refetch: vi.fn(),
    });
  });

  it('uses urql-solid data while leaving the regular query disabled', () => {
    createRoot((dispose) => {
      const [item] = useItemPreview(() => ({
        id: 'doc-1',
        type: 'document',
      }));

      expect(item()).toEqual(preview);
      const regularOptions = useQueryOptions[0]?.();
      expect(regularOptions).toMatchObject({ enabled: false });
      dispose();
    });
  });

  it('derives the pending preview from urql-solid loading state', () => {
    createGraphqlItemPreviewQueryMock.mockReturnValue({
      data: () => undefined,
      error: () => null,
      isLoading: () => true,
      isFetching: () => true,
      isEnabled: () => true,
      shouldFallback: () => false,
      refetch: vi.fn(),
    });

    createRoot((dispose) => {
      const [item] = useItemPreview(() => ({
        id: 'doc-1',
        type: 'document',
      }));

      expect(item()).toEqual({
        id: 'doc-1',
        type: 'document',
        loading: true,
      });
      dispose();
    });
  });

  it('does not write or invalidate the TanStack preview cache on GraphQL', () => {
    setPreviewFileType('doc-1', 'pdf');
    setPreviewName({
      itemId: 'doc-1',
      itemType: 'document',
      name: 'Renamed',
    });
    invalidatePreview('doc-1');

    expect(setQueryDataMock).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });
});
