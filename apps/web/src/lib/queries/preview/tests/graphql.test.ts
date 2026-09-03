import type { CacheHost, ReadRecordsByKeysArgs } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { ItemPreviewFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';

const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: getGraphqlSoupCacheHostMock,
  getGraphqlSoupClient: getGraphqlSoupClientMock,
}));

import {
  getGraphqlItemPreview,
  graphqlRecordToPreview,
  isGraphqlPreviewItem,
  readCachedGraphqlItemPreviewFromHost,
  setGraphqlPreviewFileType,
  setGraphqlPreviewName,
  setGraphqlPreviewOnCreate,
} from '../graphql';

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

  it('bypasses cached access state for security-sensitive lookups', async () => {
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
      await setGraphqlPreviewName({ id: 'doc-1', type: 'document' }, 'Renamed');
      await setGraphqlPreviewFileType('doc-1', 'pdf');
      await setGraphqlPreviewOnCreate({
        itemId: 'doc-2',
        itemType: 'document',
        name: 'Created',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      });

      expect(writeQuery).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          operationName: 'ItemPreviewNamePatch',
          data: {
            previewRecord: {
              __typename: 'GraphqlSoupDocument',
              id: 'doc-1',
              displayName: 'Renamed',
            },
          },
        })
      );
      expect(writeQuery).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          operationName: 'ItemPreviewFileTypePatch',
          data: {
            previewRecord: {
              __typename: 'GraphqlSoupDocument',
              id: 'doc-1',
              fileType: 'pdf',
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
