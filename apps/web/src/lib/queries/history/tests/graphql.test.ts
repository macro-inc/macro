import type {
  CacheHost,
  ReadRecordsByKeysArgs,
  SearchCacheArgs,
  SearchCachePage,
} from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { describe, expect, it, vi } from 'vitest';
import { buildGraphqlEntitySoupInput } from '../../soup/graphql/entity-input';
import {
  loadHistoryViewItem,
  readCachedGraphqlHistoryItems,
  stampCachedHistoryView,
} from '../graphql';

function cacheHost(
  search: (args: SearchCacheArgs) => Promise<SearchCachePage>,
  readRecordsByKeys: (
    args: ReadRecordsByKeysArgs
  ) => Promise<Array<{ recordKey: string; record: unknown }>>
): Pick<CacheHost, 'search' | 'readRecordsByKeys'> {
  return {
    search,
    readRecordsByKeys: async (args) => ({
      revision: INITIAL_CACHE_REVISION,
      records: await readRecordsByKeys(args),
    }),
  };
}

describe('cached GraphQL history', () => {
  it('keeps the pre-read generation on a delayed history write', async () => {
    const read = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const writeQuery = vi.fn(async () => ({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: false,
      changed: [],
      affectedOps: [],
      reset: false,
    }));
    const host = {
      async readRecordsByKeys() {
        started.resolve();
        await read.promise;
        return {
          revision: INITIAL_CACHE_REVISION,
          records: [
            {
              recordKey: 'GraphqlSoupDocument:delayed',
              record: {
                __typename: 'GraphqlSoupDocument',
                name: 'Note',
                viewedAt: null,
              },
            },
          ],
        };
      },
      writeQuery,
    };
    const generation = cacheSessionGeneration.capture();
    const pending = stampCachedHistoryView(
      host,
      {
        itemId: 'delayed',
        itemType: 'document',
        viewedAt: '2026-11-19T00:00:00Z',
      },
      async () => {}
    );
    await started.promise;
    await cacheSessionGeneration.transition(async () => {});
    read.resolve();
    await pending;
    expect(writeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ generation })
    );
  });

  it('filters cached backing descriptions while retaining notes, tasks and folders', async () => {
    const entries = [
      {
        id: 'description',
        typename: 'GraphqlSoupDocument',
        bucket: 'note',
        subType: { __typename: 'GraphqlInitiativeDescriptionSubType' },
      },
      {
        id: 'note',
        typename: 'GraphqlSoupDocument',
        bucket: 'note',
        subType: null,
      },
      {
        id: 'task',
        typename: 'GraphqlSoupDocument',
        bucket: 'task',
        subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
      },
      {
        id: 'folder',
        typename: 'GraphqlSoupProject',
        bucket: 'project',
        subType: null,
      },
    ];
    const host = cacheHost(
      async () => ({
        documents: entries.map((entry) => ({
          profile: 'quick-access-v1',
          recordKey: `${entry.typename}:${entry.id}`,
          bucket: entry.bucket,
          searchText: 'Same title',
          timestampMs: 1,
          sourceHash: 'hash',
        })),
        nextCursor: null,
      }),
      async ({ keys }) =>
        keys.map((recordKey) => {
          const entry = entries.find(
            (entry) => `${entry.typename}:${entry.id}` === recordKey
          )!;
          return {
            recordKey,
            record: {
              __typename: entry.typename,
              name: 'Same title',
              ownerId: 'owner',
              createdAt: '2026-09-11T00:00:00Z',
              subType: entry.subType,
            },
          };
        })
    );
    expect(
      (await readCachedGraphqlHistoryItems(host)).map((item) => item.id)
    ).toEqual(['note', 'task', 'folder']);
  });

  it('browses the indexed recent projection and materializes only final keys', async () => {
    const search = vi.fn(
      async (): Promise<SearchCachePage> => ({
        documents: [
          {
            profile: 'quick-access-v1',
            recordKey: 'GraphqlSoupDocument:document-newest',
            bucket: 'note',
            searchText: 'newest document',
            timestampMs: Date.parse('2025-01-05T00:00:00.000Z'),
            sourceHash: 'one',
          },
          {
            profile: 'quick-access-v1',
            recordKey: 'GraphqlSoupChat:chat-middle',
            bucket: 'chat',
            searchText: 'middle chat',
            timestampMs: Date.parse('2025-01-04T00:00:00.000Z'),
            sourceHash: 'two',
          },
          {
            profile: 'quick-access-v1',
            recordKey: 'GraphqlSoupDocument:document-task',
            bucket: 'task',
            searchText: 'task document',
            timestampMs: Date.parse('2025-01-03T00:00:00.000Z'),
            sourceHash: 'three',
          },
        ],
        nextCursor: null,
      })
    );
    const readRecordsByKeys = vi.fn(async (args: ReadRecordsByKeysArgs) =>
      args.keys.map((recordKey) => {
        const isChat = recordKey === 'GraphqlSoupChat:chat-middle';
        const isTask = recordKey === 'GraphqlSoupDocument:document-task';
        return {
          recordKey,
          record: {
            __typename: isChat ? 'GraphqlSoupChat' : 'GraphqlSoupDocument',
            name:
              recordKey === 'GraphqlSoupDocument:document-newest'
                ? 'Newest Document'
                : isChat
                  ? 'Middle Chat'
                  : 'Task Document',
            ownerId: isChat ? 'chat-owner' : 'document-owner',
            createdAt: isChat
              ? '2025-01-01T00:00:00.000Z'
              : '2024-12-31T00:00:00.000Z',
            updatedAt: '2025-01-02T00:00:00.000Z',
            viewedAt: isChat ? null : '2025-01-01T12:00:00.000Z',
            ...(!isChat && {
              subType: isTask
                ? { __typename: 'GraphqlTaskSubType', isCompleted: true }
                : null,
            }),
          },
        };
      })
    );

    const result = await readCachedGraphqlHistoryItems(
      cacheHost(search, readRecordsByKeys)
    );

    expect(search).toHaveBeenCalledWith({
      profile: 'quick-access-v1',
      buckets: [
        'document',
        'note',
        'task',
        'snippet',
        'skill',
        'chat',
        'project',
      ],
      query: '',
      limit: 500,
    });
    expect(result.map(({ id }) => id)).toEqual([
      'document-newest',
      'chat-middle',
      'document-task',
    ]);
    expect(result[0]).toMatchObject({
      ownerId: 'document-owner',
      createdAt: '2024-12-31T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      viewedAt: '2025-01-01T12:00:00.000Z',
    });
    expect(result[1]).toMatchObject({
      updatedAt: '2025-01-02T00:00:00.000Z',
      viewedAt: null,
    });
    expect(result[2]).toMatchObject({
      type: 'document',
      fileType: 'md',
      ownerId: 'document-owner',
      createdAt: '2024-12-31T00:00:00.000Z',
      subType: { type: 'task', is_completed: true },
    });
    expect(readRecordsByKeys).toHaveBeenCalledTimes(2);
    expect(
      readRecordsByKeys.mock.calls.map(([{ fragmentName }]) => fragmentName)
    ).toEqual(['GraphqlDocumentQuickAccessName', 'GraphqlChatQuickAccessName']);
    for (const [{ document }] of readRecordsByKeys.mock.calls) {
      expect(document).toMatch(/QuickAccessName on GraphqlSoup/);
      expect(document).toMatch(/name/);
      expect(document).toMatch(/updatedAt/);
      expect(document).toMatch(/viewedAt/);
    }
  });

  it.each(['pdf', 'spreadsheet'])(
    'preserves %s file types for quick-access navigation and icons',
    async (fileType) => {
      const id = `document-${fileType}`;
      const documentKey = `GraphqlSoupDocument:${id}`;
      const host = cacheHost(
        async () => ({
          documents: [
            {
              profile: 'quick-access-v1',
              recordKey: documentKey,
              bucket: 'document',
              searchText: `example ${fileType}`,
              timestampMs: Date.parse('2025-01-05T00:00:00.000Z'),
              sourceHash: fileType,
            },
          ],
          nextCursor: null,
        }),
        async ({ document }) => {
          expect(document).toMatch(/fileType/);
          return [
            {
              recordKey: documentKey,
              record: {
                __typename: 'GraphqlSoupDocument',
                name: `Example ${fileType}`,
                fileType,
                ownerId: 'document-owner',
                createdAt: '2025-01-01T00:00:00.000Z',
                subType: null,
              },
            },
          ];
        }
      );

      await expect(readCachedGraphqlHistoryItems(host)).resolves.toMatchObject([
        { id, type: 'document', fileType },
      ]);
    }
  );

  it('omits keys whose minimal name projection is incomplete', async () => {
    const search = vi.fn(
      async (): Promise<SearchCachePage> => ({
        documents: [
          {
            profile: 'quick-access-v1',
            recordKey: 'GraphqlSoupDocument:missing-name',
            bucket: 'document',
            searchText: 'fallback text',
            timestampMs: 1,
            sourceHash: 'hash',
          },
        ],
        nextCursor: null,
      })
    );
    const readRecordsByKeys = vi.fn(async () => []);

    await expect(
      readCachedGraphqlHistoryItems(cacheHost(search, readRecordsByKeys))
    ).resolves.toEqual([]);
  });
});

describe('cached history views', () => {
  const viewedAt = '2026-11-18T21:00:00.000Z';
  function viewHost(
    held: () => boolean,
    stored: { viewedAt: string | null } = { viewedAt: null }
  ) {
    const readRecordsByKeys = vi.fn(async ({ keys }: ReadRecordsByKeysArgs) =>
      held()
        ? keys.map((recordKey) => ({
            recordKey,
            record: {
              __typename: recordKey.split(':')[0],
              name: 'Old canvas',
              ownerId: 'owner',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
              viewedAt: stored.viewedAt,
            },
          }))
        : []
    );
    const writeQuery = vi.fn(
      async (args: {
        data: { soupUpdates: Array<{ item: { viewedAt: string } }> };
      }) => {
        stored.viewedAt = args.data.soupUpdates[0].item.viewedAt;
        return { revision: INITIAL_CACHE_REVISION, changed: true };
      }
    );
    const host = {
      readRecordsByKeys: async (args: ReadRecordsByKeysArgs) => ({
        revision: INITIAL_CACHE_REVISION,
        records: await readRecordsByKeys(args),
      }),
      writeQuery,
    } as unknown as Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>;
    return { host, readRecordsByKeys, writeQuery, stored };
  }

  it('stamps the viewed time on a cached record without loading it', async () => {
    const { host, readRecordsByKeys, writeQuery } = viewHost(() => true);
    const load = vi.fn(async () => {});

    await expect(
      stampCachedHistoryView(
        host,
        { itemId: 'canvas', itemType: 'document', viewedAt },
        load
      )
    ).resolves.toBe(true);

    expect(load).not.toHaveBeenCalled();
    expect(readRecordsByKeys).toHaveBeenCalledWith(
      expect.objectContaining({ keys: ['GraphqlSoupDocument:canvas'] })
    );
    expect(writeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'HistoryViewedAtCacheWrite',
        data: {
          soupUpdates: [
            {
              __typename: 'SoupUpdated',
              item: {
                __typename: 'GraphqlSoupDocument',
                id: 'canvas',
                viewedAt,
              },
            },
          ],
        },
      })
    );
  });

  it('loads a record the cache does not hold, then stamps it', async () => {
    let held = false;
    const { host, writeQuery } = viewHost(() => held);
    const load = vi.fn(async () => {
      held = true;
    });

    await expect(
      stampCachedHistoryView(
        host,
        { itemId: 'folder', itemType: 'project', viewedAt },
        load
      )
    ).resolves.toBe(true);

    expect(load).toHaveBeenCalledWith('GraphqlSoupProject');
    expect(writeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          soupUpdates: [
            {
              __typename: 'SoupUpdated',
              item: {
                __typename: 'GraphqlSoupProject',
                id: 'folder',
                viewedAt,
              },
            },
          ],
        },
      })
    );
  });

  it('stamps nothing when the record is still missing after loading', async () => {
    const { host, writeQuery } = viewHost(() => false);

    await expect(
      stampCachedHistoryView(
        host,
        { itemId: 'gone', itemType: 'chat', viewedAt },
        async () => {}
      )
    ).resolves.toBe(false);
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it('ignores item types cached history does not list', async () => {
    const { host, readRecordsByKeys, writeQuery } = viewHost(() => true);

    await expect(
      stampCachedHistoryView(
        host,
        { itemId: 'session', itemType: 'agent_session', viewedAt },
        async () => {}
      )
    ).resolves.toBe(false);
    expect(readRecordsByKeys).not.toHaveBeenCalled();
    expect(writeQuery).not.toHaveBeenCalled();
  });

  it('keeps a later viewed time the cache already holds', async () => {
    const later = '2026-11-18T21:00:05.000Z';
    const { host, writeQuery, stored } = viewHost(() => true, {
      viewedAt: later,
    });

    await expect(
      stampCachedHistoryView(
        host,
        { itemId: 'canvas', itemType: 'document', viewedAt },
        async () => {}
      )
    ).resolves.toBe(true);
    expect(writeQuery).not.toHaveBeenCalled();
    expect(stored.viewedAt).toBe(later);
  });

  it('applies overlapping stamps in turn, so the later view wins', async () => {
    const stored = { viewedAt: null as string | null };
    let reads = 0;
    let releaseFirstRead: () => void = () => {};
    const writeQuery = vi.fn(
      async (args: {
        data: { soupUpdates: Array<{ item: { viewedAt: string } }> };
      }) => {
        stored.viewedAt = args.data.soupUpdates[0].item.viewedAt;
        return { revision: INITIAL_CACHE_REVISION, changed: true };
      }
    );
    const host = {
      readRecordsByKeys: async ({ keys }: ReadRecordsByKeysArgs) => {
        const snapshot = stored.viewedAt;
        reads += 1;
        if (reads === 1)
          await new Promise<void>((resolve) => {
            releaseFirstRead = resolve;
          });
        return {
          revision: INITIAL_CACHE_REVISION,
          records: keys.map((recordKey) => ({
            recordKey,
            record: {
              __typename: 'GraphqlSoupDocument',
              name: 'Old canvas',
              ownerId: 'owner',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
              viewedAt: snapshot,
            },
          })),
        };
      },
      writeQuery,
    } as unknown as Pick<CacheHost, 'readRecordsByKeys' | 'writeQuery'>;
    const later = '2026-11-18T21:00:05.000Z';

    const first = stampCachedHistoryView(
      host,
      { itemId: 'race', itemType: 'document', viewedAt },
      async () => {}
    );
    const second = stampCachedHistoryView(
      host,
      { itemId: 'race', itemType: 'document', viewedAt: later },
      async () => {}
    );
    await vi.waitFor(() => expect(reads).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirstRead();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(stored.viewedAt).toBe(later);
  });

  it('loads one item by id from the network', async () => {
    const toPromise = vi.fn(async () => ({ data: {}, error: undefined }));
    const query = vi.fn(() => ({ toPromise }));

    await loadHistoryViewItem(
      { query } as unknown as Parameters<typeof loadHistoryViewItem>[0],
      'GraphqlSoupChat',
      'chat-1'
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        definitions: expect.arrayContaining([
          expect.objectContaining({
            name: expect.objectContaining({ value: 'HistoryViewItem' }),
          }),
        ]),
      }),
      { input: buildGraphqlEntitySoupInput('CHAT', 'chat-1') },
      { requestPolicy: 'network-only' }
    );
  });

  it('throws when the item cannot be loaded', async () => {
    const error = new Error('offline');
    const query = vi.fn(() => ({
      toPromise: async () => ({ data: undefined, error }),
    }));

    await expect(
      loadHistoryViewItem(
        { query } as unknown as Parameters<typeof loadHistoryViewItem>[0],
        'GraphqlSoupDocument',
        'doc-1'
      )
    ).rejects.toBe(error);
  });
});
