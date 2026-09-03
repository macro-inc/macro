import type { CacheHost, ReadRecordsByKeysArgs } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { ItemPreviewFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import {
  graphqlRecordToPreview,
  isGraphqlPreviewItem,
  readCachedGraphqlItemPreviewFromHost,
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
      ownerId: 'owner-1',
      fileType: 'md',
      updatedAt: '2026-01-01T00:00:00.000Z',
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
      owner: 'owner-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
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
          ownerId: 'owner-1',
          updatedAt: '2026-01-01T00:00:00.000Z',
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
