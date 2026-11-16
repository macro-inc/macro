import { beginQueryAuthorizationReset } from '@app/lib/urql-solid/authorization';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemEntity, PreviewItem } from '../types';

const policy = vi.hoisted(() => ({ allowed: true, graphql: true }));
const getGraphqlPreviewMock = vi.hoisted(() => vi.fn());
const fetchRestPreviewMock = vi.hoisted(() => vi.fn());
const fetchQueryMock = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => policy.allowed,
}));
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryOptions = vi.hoisted(() => [] as Array<() => unknown>);
const getQueryDataMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const canWriteGraphqlPreviewCacheMock = vi.hoisted(() => vi.fn());
const createGraphqlItemPreviewQueryMock = vi.hoisted(() => vi.fn());
const setGraphqlPreviewFileTypeMock = vi.hoisted(() => vi.fn());
const setGraphqlPreviewNameMock = vi.hoisted(() => vi.fn());
const setGraphqlPreviewOnCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => policy.graphql,
  LOCAL_ONLY: false,
}));

vi.mock('@tanstack/solid-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../client', () => ({
  queryClient: {
    fetchQuery: fetchQueryMock,
    getQueryData: getQueryDataMock,
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
  fetchRestPreviewBatch: fetchRestPreviewMock,
}));

vi.mock('../graphql', () => ({
  canWriteGraphqlPreviewCache: canWriteGraphqlPreviewCacheMock,
  createGraphqlItemPreviewQuery: createGraphqlItemPreviewQueryMock,
  getGraphqlItemPreview: getGraphqlPreviewMock,
  isGraphqlPreviewItem: () => true,
  setGraphqlPreviewFileType: setGraphqlPreviewFileTypeMock,
  setGraphqlPreviewName: setGraphqlPreviewNameMock,
  setGraphqlPreviewOnCreate: setGraphqlPreviewOnCreateMock,
}));

const {
  getItemPreview,
  invalidatePreview,
  setPreviewFileType,
  setPreviewName,
  setPreviewOnCreate,
  useItemIdentity,
  useItemPreview,
  useItemRawName,
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
    canWriteGraphqlPreviewCacheMock.mockReturnValue(true);
    useQueryMock.mockImplementation((options: () => unknown) => {
      useQueryOptions.push(options);
      return { isLoading: false, isPending: false, isSuccess: false };
    });
    getQueryDataMock.mockReturnValue({ id: 'user-1' });
    invalidateQueriesMock.mockResolvedValue(undefined);
    setGraphqlPreviewFileTypeMock.mockResolvedValue(undefined);
    setGraphqlPreviewNameMock.mockResolvedValue(undefined);
    setGraphqlPreviewOnCreateMock.mockResolvedValue(undefined);
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

  it('uses urql-solid data without building the regular queries', () => {
    createRoot((dispose) => {
      const [item] = useItemPreview(() => ({
        id: 'doc-1',
        type: 'document',
      }));

      expect(item()).toEqual(preview);
      expect(useQueryOptions).toHaveLength(0);
      dispose();
    });
  });

  it('builds the regular query once the GraphQL preview falls back', () => {
    createRoot((dispose) => {
      const [fallback, setFallback] = createSignal(false);
      createGraphqlItemPreviewQueryMock.mockReturnValue({
        data: () => undefined,
        shouldFallback: fallback,
        refetch: vi.fn(),
      });
      useItemPreview(() => ({ id: 'doc-1', type: 'document' }));
      expect(useQueryOptions).toHaveLength(0);

      setFallback(true);
      expect(useQueryOptions).toHaveLength(1);
      expect(useQueryOptions[0]?.()).toMatchObject({ enabled: true });
      dispose();
    });
  });

  it('keeps pending GraphQL metadata distinct from REST and loaded-empty properties', () => {
    createRoot((dispose) => {
      const [data, setData] = createSignal<PreviewItem>(preview);
      const [fallback, setFallback] = createSignal(false);
      createGraphqlItemPreviewQueryMock.mockReturnValue({
        data,
        shouldFallback: fallback,
        refetch: vi.fn(),
      });
      const [, controls] = useItemPreview(() => ({
        id: 'doc-1',
        type: 'document',
      }));
      expect(controls.documentProperties()).toMatchObject({
        properties: undefined,
        canEdit: false,
      });
      setData({
        ...preview,
        documentMetadata: { properties: [], canEdit: true },
      });
      expect(controls.documentProperties()).toMatchObject({
        properties: [],
        canEdit: true,
      });
      setFallback(true);
      expect(controls.documentProperties()).toBeUndefined();
      dispose();
    });
  });

  it('keeps raw-name reads on the lightweight selection', () => {
    createRoot((dispose) => {
      const name = useItemRawName(() => ({ id: 'doc-1', type: 'document' }));
      expect(name()).toBe('Document');
      expect(createGraphqlItemPreviewQueryMock).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        false
      );
      dispose();
    });
  });

  it('reads live appearance without loading document properties or exposing inaccessible metadata', () => {
    createRoot((dispose) => {
      const [data, setData] = createSignal<PreviewItem | undefined>();
      createGraphqlItemPreviewQueryMock.mockReturnValue({
        data,
        shouldFallback: () => false,
      });
      const identity = useItemIdentity(() => ({
        id: 'doc-1',
        type: 'document',
      }));
      expect(identity()).toBeUndefined();
      setData({
        ...preview,
        appearance: { icon: { kind: 'emoji', value: '🚀' }, color: null },
      });
      expect(identity()?.appearance?.icon).toEqual({
        kind: 'emoji',
        value: '🚀',
      });
      expect(createGraphqlItemPreviewQueryMock).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        false
      );
      setData({
        id: 'doc-1',
        type: 'document',
        access: 'no_access',
        loading: false,
      });
      expect(identity()).toBeUndefined();
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

  it('stays loading while a GraphQL miss starts its REST fallback', () => {
    createGraphqlItemPreviewQueryMock.mockReturnValue({
      data: () => undefined,
      error: () => null,
      isLoading: () => false,
      isFetching: () => false,
      isEnabled: () => true,
      shouldFallback: () => true,
      refetch: vi.fn(),
    });
    useQueryMock.mockImplementation((options: () => unknown) => {
      useQueryOptions.push(options);
      return { isLoading: false, isPending: true, isSuccess: false };
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

  it('does not turn a failed REST fallback into a permission result', () => {
    createGraphqlItemPreviewQueryMock.mockReturnValue({
      data: () => undefined,
      error: () => null,
      isLoading: () => false,
      isFetching: () => false,
      isEnabled: () => true,
      shouldFallback: () => true,
      refetch: vi.fn(),
    });
    useQueryMock.mockImplementation((options: () => unknown) => {
      useQueryOptions.push(options);
      return {
        data: undefined,
        isLoading: false,
        isPending: false,
        isSuccess: false,
        isError: true,
      };
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

  it('seeds REST when the normalized GraphQL cache host is unavailable', () => {
    canWriteGraphqlPreviewCacheMock.mockReturnValue(false);

    setPreviewOnCreate({
      itemId: 'doc-2',
      itemType: 'document',
      name: 'Created',
      fileType: 'md',
    });

    expect(setGraphqlPreviewOnCreateMock).not.toHaveBeenCalled();
    expect(setQueryDataMock).toHaveBeenCalledOnce();
    const updater = setQueryDataMock.mock.calls[0]?.[1];
    expect(updater(undefined)).toMatchObject({
      id: 'doc-2',
      type: 'document',
      access: 'access',
      rawName: 'Created',
      fileType: 'md',
    });
  });

  it('keeps GraphQL writes out of the TanStack preview cache', () => {
    setPreviewFileType('doc-1', 'pdf');
    setPreviewName({
      itemId: 'doc-1',
      itemType: 'document',
      name: 'Renamed',
    });
    setPreviewOnCreate({
      itemId: 'doc-2',
      itemType: 'document',
      name: 'Created',
      fileType: 'md',
    });

    expect(setGraphqlPreviewFileTypeMock).toHaveBeenCalledWith(
      'doc-1',
      'pdf',
      'user-1'
    );
    expect(setGraphqlPreviewNameMock).toHaveBeenCalledWith(
      { id: 'doc-1', type: 'document' },
      'Renamed',
      'user-1'
    );
    expect(setGraphqlPreviewOnCreateMock).toHaveBeenCalledWith(
      {
        itemId: 'doc-2',
        itemType: 'document',
        name: 'Created',
        fileType: 'md',
        subType: undefined,
      },
      'user-1'
    );
    expect(setQueryDataMock).not.toHaveBeenCalled();
  });

  it('invalidates only active REST fallbacks under the GraphQL flag', async () => {
    await invalidatePreview('doc-1');

    const options = invalidateQueriesMock.mock.calls[0]?.[0];
    expect(options.queryKey).toContain('doc-1');
    expect(options.predicate({ isActive: () => false })).toBe(false);
    expect(options.predicate({ isActive: () => true })).toBe(true);
  });
});

for (const transport of ['graphql', 'fallback', 'rest'] as const) {
  it(`discards a late imperative CRM mention from ${transport} after authority changes`, async () => {
    policy.allowed = true;
    policy.graphql = transport !== 'rest';
    let resolve!: (value: unknown) => void;
    const delayed = new Promise((done) => {
      resolve = done;
    });
    getGraphqlPreviewMock.mockReturnValue(
      transport === 'fallback' ? undefined : delayed
    );
    fetchRestPreviewMock.mockReturnValue(delayed);
    fetchQueryMock.mockReturnValue(delayed);
    const pending = getItemPreview({
      type: 'crm_contact',
      id: 'private-contact',
    });
    await Promise.resolve();
    const resume = beginQueryAuthorizationReset();
    policy.allowed = false;
    const record = {
      ...preview,
      id: 'private-contact',
      type: 'crm_contact',
      name: 'Private record',
    };
    resolve(
      transport === 'fallback' ? new Map([['private-contact', record]]) : record
    );
    expect(await pending).toMatchObject({
      id: 'private-contact',
      access: 'no_access',
    });
    resume();
    policy.allowed = true;
    policy.graphql = true;
  });
}

it.each(['graphql', 'rest'] as const)(
  'conceals cached email previews during retirement on %s and resumes after verification',
  async (transport) => {
    policy.allowed = true;
    policy.graphql = transport === 'graphql';
    const item: ItemEntity = { id: 'thread-1', type: 'email' };
    const email = {
      ...preview,
      ...item,
      name: 'Shared email',
      rawName: 'Shared email',
    };
    getGraphqlPreviewMock.mockResolvedValue(email);
    fetchQueryMock.mockResolvedValue(email);
    createGraphqlItemPreviewQueryMock.mockReturnValue({
      data: () => email,
      shouldFallback: () => transport === 'rest',
      isLoading: () => false,
    });
    useQueryMock.mockReturnValue({
      data: email,
      isPending: false,
      isSuccess: true,
    });
    let dispose!: () => void;
    const current = createRoot((cleanup) => {
      dispose = cleanup;
      return useItemPreview(() => item)[0];
    });
    const resume = beginQueryAuthorizationReset();
    try {
      expect(current()).toEqual({
        ...item,
        loading: false,
        access: 'no_access',
      });
      await expect(getItemPreview(item)).resolves.toEqual({
        ...item,
        loading: false,
        access: 'no_access',
      });
      resume();
      expect(current()).toEqual(email);
      await expect(getItemPreview(item)).resolves.toEqual(email);
    } finally {
      resume();
      dispose();
      policy.graphql = true;
    }
  }
);
