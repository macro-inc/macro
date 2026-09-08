import type { CacheHost, ReadRecordsByKeysArgs } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type {
  ItemPreviewDetailsFieldsFragment,
  ItemPreviewFieldsFragment,
  ItemPreviewQuery,
} from '@service-storage/graphql/generated/graphql';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createUrqlQueryMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());

vi.mock('@app/lib/urql-solid', () => ({
  createUrqlQuery: createUrqlQueryMock,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: getGraphqlSoupCacheHostMock,
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  mapGraphqlProperties: (properties: unknown[]) => properties,
}));

import {
  createGraphqlItemPreviewQuery,
  getGraphqlItemPreview,
  graphqlRecordToPreview,
  isGraphqlPreviewItem,
  readCachedGraphqlItemPreviewFromHost,
  setGraphqlPreviewFileType,
  setGraphqlPreviewName,
  setGraphqlPreviewOnCreate,
} from '../graphql';

beforeEach(() => {
  vi.useFakeTimers();
  getGraphqlSoupClientMock.mockReturnValue({});
  getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
  createUrqlQueryMock.mockClear();
});
afterEach(() => vi.useRealTimers());

function cacheHost(
  read: (
    args: ReadRecordsByKeysArgs
  ) => Promise<Array<{ recordKey: string; record: unknown }>>
): Pick<CacheHost, 'readRecordsByKeys'> {
  return {
    readRecordsByKeys: async (args) => ({
      revision: INITIAL_CACHE_REVISION,
      records: await read(args),
    }),
  };
}

describe('GraphQL item previews', () => {
  it('maps normalized document fields without the full Soup projection', () => {
    const record = {
      __typename: 'GraphqlSoupDocument',
      id: 'doc-1',
      displayName: 'Roadmap',
      documentName: 'Roadmap',
      fileType: 'md',
      subType: {
        __typename: 'GraphqlTaskSubType',
        isCompleted: true,
      },
    } satisfies ItemPreviewFieldsFragment;

    expect(graphqlRecordToPreview(record)).toEqual({
      id: 'doc-1',
      type: 'document',
      access: 'access',
      loading: false,
      rawName: 'Roadmap',
      name: 'Roadmap',
      fileType: 'md',
      subType: { type: 'task', is_completed: true },
    });
  });

  it('carries loaded-empty properties and permission on the preview', () => {
    const record = {
      __typename: 'GraphqlSoupDocument',
      id: 'task-1',
      displayName: 'Task',
      documentName: 'Task',
      fileType: 'md',
      subType: null,
      properties: [],
      viewerPermission: {
        __typename: 'GraphqlAccessLevelPermission',
        accessLevel: 'EDIT',
      },
    } satisfies ItemPreviewDetailsFieldsFragment;
    expect(graphqlRecordToPreview(record)).toMatchObject({
      documentMetadata: { properties: [], canEdit: true },
    });
    expect(
      graphqlRecordToPreview({ ...record, viewerPermission: null })
    ).toMatchObject({ documentMetadata: { canEdit: false } });
  });

  it('shares a live rich query, keyed cache read, and refresh for multiple previews', async () => {
    const read = vi.fn(async () => []);
    getGraphqlSoupCacheHostMock.mockReturnValue(cacheHost(read));
    const [result, setResult] = createStore({
      data: undefined as ItemPreviewQuery | undefined,
      error: null,
      isError: false,
      isFetched: false,
      isFetching: true,
      isLoading: true,
      isEnabled: true,
      stale: false,
      refetch: vi.fn(async () => undefined),
    });
    createUrqlQueryMock.mockReturnValue(result);
    const { queries, dispose } = createRoot((dispose) => ({
      queries: ['one', 'two', 'one'].map((id) =>
        createGraphqlItemPreviewQuery(
          () => ({ id, type: 'document' }),
          () => true
        )
      ),
      dispose,
    }));
    try {
      expect(queries.every((q) => q.isLoading())).toBe(true);
      await vi.advanceTimersByTimeAsync(30);
      expect(createUrqlQueryMock).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      const options = createUrqlQueryMock.mock.calls[0][0]();
      expect(options.query.definitions[0].name.value).toBe('ItemPreviews');
      expect(options.variables.input.initial.limit).toBe(2);
      const records = ['one', 'two'].map((id) => ({
        __typename: 'GraphqlSoupDocument' as const,
        id,
        displayName: id,
        documentName: id,
        fileType: 'md',
        subType: null,
      }));
      setResult({
        data: { user: { id: 'viewer', soup: { items: records } } },
        isFetched: true,
        isFetching: false,
        isLoading: false,
      });
      expect(queries.map((q) => q.data())).toMatchObject([
        { name: 'one' },
        { name: 'two' },
        { name: 'one' },
      ]);
      // Simulate a pushed normalized-cache update: all consumers remain live.
      setResult('data', 'user', 'soup', 'items', 0, 'displayName', 'Renamed');
      expect(queries[0].data()).toMatchObject({ name: 'Renamed' });
      expect(queries[2].data()).toMatchObject({ name: 'Renamed' });
      await Promise.all(queries.map((q) => q.refetch()));
      expect(result.refetch).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('isolates missing records and partial errors within a heterogeneous batch', async () => {
    const [result] = createStore({
      data: {
        user: {
          id: 'viewer',
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupProject' as const,
                id: 'same',
                displayName: 'Project',
                projectName: 'Project',
              },
              {
                __typename: 'GraphqlSoupDocument' as const,
                id: 'same',
                displayName: 'Document',
                documentName: 'Document',
                fileType: 'md',
                subType: null,
              },
            ],
          },
        },
      },
      error: new Error('A sibling resolver failed'),
      isError: true,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isEnabled: true,
      stale: false,
      refetch: vi.fn(async () => undefined),
    });
    createUrqlQueryMock.mockReturnValue(result);
    const { queries, dispose } = createRoot((dispose) => ({
      queries: [
        createGraphqlItemPreviewQuery(
          () => ({ id: 'same', type: 'document' }),
          () => true
        ),
        createGraphqlItemPreviewQuery(
          () => ({ id: 'same', type: 'project' }),
          () => true
        ),
        createGraphqlItemPreviewQuery(
          () => ({ id: 'missing', type: 'document' }),
          () => true
        ),
      ],
      dispose,
    }));
    await vi.advanceTimersByTimeAsync(30);
    expect(queries[0].data()).toMatchObject({ name: 'Document' });
    expect(queries[1].data()).toMatchObject({ name: 'Project' });
    expect(queries.map((query) => query.shouldFallback())).toEqual([
      false,
      false,
      true,
    ]);
    dispose();
    await queries[0].refetch();
    expect(result.refetch).not.toHaveBeenCalled();
  });

  it('uses a cached viewer-relative direct-message name when available', () => {
    const record = {
      __typename: 'GraphqlSoupChannel',
      id: 'channel-1',
      displayName: 'Jordan',
      channelDisplayName: null,
      channelType: 'DIRECT_MESSAGE',
    } satisfies ItemPreviewFieldsFragment;

    expect(graphqlRecordToPreview(record)).toMatchObject({
      type: 'channel',
      rawName: 'Jordan',
      channelType: 'direct_message',
    });
  });

  it('leaves unnamed direct messages on the viewer-relative REST path', () => {
    const record = {
      __typename: 'GraphqlSoupChannel',
      id: 'channel-1',
      displayName: null,
      channelDisplayName: null,
      channelType: 'DIRECT_MESSAGE',
    } satisfies ItemPreviewFieldsFragment;

    expect(graphqlRecordToPreview(record)).toBeUndefined();
  });

  it('reads the exact normalized key through the minimal fragment', async () => {
    const readRecordsByKeys = vi.fn(async (args: ReadRecordsByKeysArgs) => [
      {
        recordKey: args.keys[0],
        record: {
          __typename: 'GraphqlSoupProject',
          id: 'project-1',
          displayName: 'Launch',
          projectName: 'Launch',
        },
      },
    ]);

    await expect(
      readCachedGraphqlItemPreviewFromHost(cacheHost(readRecordsByKeys), {
        id: 'project-1',
        type: 'project',
      })
    ).resolves.toMatchObject({
      id: 'project-1',
      type: 'project',
      rawName: 'Launch',
    });

    expect(readRecordsByKeys).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ['GraphqlSoupProject:project-1'],
        fragmentName: 'ItemPreviewFields',
      })
    );
    expect(readRecordsByKeys.mock.calls[0]?.[0].document).not.toContain(
      'properties'
    );
  });

  it('holds creation grace before the asynchronous cache seed is readable', async () => {
    vi.useFakeTimers();
    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    getGraphqlSoupCacheHostMock.mockReturnValue({
      disabled: false,
      writeQuery: () => write,
      readRecordsByKeys: async () => ({
        revision: INITIAL_CACHE_REVISION,
        records: [],
      }),
    });
    const [result] = createStore({
      data: undefined,
      error: null,
      isError: false,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isEnabled: true,
      stale: false,
      refetch: vi.fn(async () => undefined),
    });
    createUrqlQueryMock.mockReturnValue(result);

    try {
      const seed = setGraphqlPreviewOnCreate(
        {
          itemId: 'new-doc',
          itemType: 'document',
          name: 'New document',
          fileType: 'md',
        },
        'user-1'
      );

      createRoot((dispose) => {
        const query = createGraphqlItemPreviewQuery(
          () => ({ id: 'new-doc', type: 'document' }),
          () => true
        );

        vi.advanceTimersByTime(30);
        expect(query.data()).toBeUndefined();
        expect(query.shouldFallback()).toBe(false);
        dispose();
      });

      finishWrite();
      await seed;
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps an established REST fallback selected during GraphQL refresh', () => {
    getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
    const [result, setResult] = createStore({
      data: undefined as ItemPreviewQuery | undefined,
      error: null,
      isError: false,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isEnabled: true,
      stale: false,
      refetch: vi.fn(async () => undefined),
    });
    createUrqlQueryMock.mockReturnValue(result);

    createRoot((dispose) => {
      const query = createGraphqlItemPreviewQuery(
        () => ({ id: 'missing-doc', type: 'document' }),
        () => true
      );

      vi.advanceTimersByTime(30);
      expect(query.shouldFallback()).toBe(true);
      setResult({ isFetching: true });
      expect(query.shouldFallback()).toBe(true);
      setResult({
        data: {
          user: {
            id: 'user-1',
            soup: {
              items: [
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'missing-doc',
                  displayName: 'Now available',
                  documentName: 'Now available',
                  fileType: 'md',
                  subType: null,
                },
              ],
            },
          },
        },
        isFetched: true,
        isFetching: false,
      });
      expect(query.shouldFallback()).toBe(false);
      dispose();
    });
  });

  it('returns from REST fallback when a delayed cache read succeeds', async () => {
    let finishRead!: (
      records: Array<{ recordKey: string; record: unknown }>
    ) => void;
    const read = new Promise<Array<{ recordKey: string; record: unknown }>>(
      (resolve) => {
        finishRead = resolve;
      }
    );
    getGraphqlSoupCacheHostMock.mockReturnValue(cacheHost(() => read));
    const [result] = createStore({
      data: undefined as ItemPreviewQuery | undefined,
      error: { networkError: new Error('offline') },
      isError: true,
      isFetched: true,
      isFetching: false,
      isLoading: false,
      isEnabled: true,
      stale: false,
      refetch: vi.fn(async () => undefined),
    });
    createUrqlQueryMock.mockReturnValue(result);

    const { query, dispose } = createRoot((dispose) => ({
      query: createGraphqlItemPreviewQuery(
        () => ({ id: 'cached-doc', type: 'document' }),
        () => true
      ),
      dispose,
    }));

    try {
      await vi.advanceTimersByTimeAsync(30);
      expect(query.shouldFallback()).toBe(true);
      finishRead([
        {
          recordKey: 'GraphqlSoupDocument:cached-doc',
          record: {
            __typename: 'GraphqlSoupDocument',
            id: 'cached-doc',
            displayName: 'Cached document',
            documentName: 'Cached document',
            fileType: 'md',
            subType: null,
          },
        },
      ]);

      await vi.waitFor(() => {
        expect(query.data()).toMatchObject({ name: 'Cached document' });
        expect(query.shouldFallback()).toBe(false);
      });
    } finally {
      dispose();
    }
  });

  it('bypasses cached access state for security-sensitive lookups', async () => {
    getGraphqlSoupCacheHostMock.mockClear();
    const query = vi.fn(() => ({
      toPromise: async () => ({
        data: {
          user: {
            soup: {
              items: [
                {
                  __typename: 'GraphqlSoupDocument',
                  id: 'doc-1',
                  displayName: 'Roadmap',
                  documentName: 'Roadmap',
                  fileType: 'md',
                  subType: null,
                },
              ],
            },
          },
        },
      }),
    }));
    getGraphqlSoupClientMock.mockReturnValue({ query });

    await expect(
      getGraphqlItemPreview(
        { id: 'doc-1', type: 'document' },
        { requireFresh: true }
      )
    ).resolves.toMatchObject({ access: 'access', name: 'Roadmap' });

    expect(getGraphqlSoupCacheHostMock).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      requestPolicy: 'network-only',
    });
  });

  it('writes optimistic patches and complete creation records to normalized cache', async () => {
    vi.useFakeTimers();
    const writeQuery = vi.fn(async () => undefined);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      disabled: false,
      writeQuery,
    });

    try {
      await setGraphqlPreviewName(
        { id: 'doc-1', type: 'document' },
        'Renamed',
        'user-1'
      );
      await setGraphqlPreviewFileType('doc-1', 'pdf', 'user-1');
      await setGraphqlPreviewOnCreate(
        {
          itemId: 'doc-2',
          itemType: 'document',
          name: 'Created',
          fileType: 'md',
          subType: { type: 'task', is_completed: false },
        },
        'user-1'
      );

      expect(writeQuery).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          operationName: 'ItemPreviewNameCacheWrite',
          data: {
            user: {
              id: 'user-1',
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupDocument',
                    id: 'doc-1',
                    displayName: 'Renamed',
                  },
                ],
              },
            },
          },
        })
      );
      expect(writeQuery).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          operationName: 'ItemPreviewFileTypeCacheWrite',
          data: {
            user: {
              id: 'user-1',
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupDocument',
                    id: 'doc-1',
                    fileType: 'pdf',
                  },
                ],
              },
            },
          },
        })
      );
      expect(writeQuery).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          operationName: 'ItemPreview',
          data: {
            user: {
              id: 'user-1',
              soup: {
                items: [
                  expect.objectContaining({
                    __typename: 'GraphqlSoupDocument',
                    id: 'doc-2',
                    displayName: 'Created',
                    documentName: 'Created',
                    fileType: 'md',
                    subType: {
                      __typename: 'GraphqlTaskSubType',
                      isCompleted: false,
                    },
                  }),
                ],
              },
            },
          },
        })
      );
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps unsupported and enriched preview variants off GraphQL', () => {
    expect(
      isGraphqlPreviewItem({ id: 'event-1', type: 'calendar_event' })
    ).toBe(false);
    expect(
      isGraphqlPreviewItem({
        id: 'channel-1',
        type: 'channel',
        messageId: 'message-1',
      })
    ).toBe(false);
    expect(isGraphqlPreviewItem({ id: 'doc-1', type: 'document' })).toBe(true);
  });
});
