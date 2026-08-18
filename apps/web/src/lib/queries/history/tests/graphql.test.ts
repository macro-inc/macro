import type { CacheHost, ReadRecordsArgs } from '@graphql-cache/index';
import type {
  GraphqlChatHistoryFieldsFragment,
  GraphqlDocumentHistoryFieldsFragment,
  GraphqlProjectHistoryFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, vi } from 'vitest';
import { readCachedGraphqlHistoryItems } from '../graphql';

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name || 'Untitled',
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));

const createdAt = '2025-01-01T00:00:00.000Z';

function document(
  overrides: Partial<GraphqlDocumentHistoryFieldsFragment> = {}
): GraphqlDocumentHistoryFieldsFragment {
  return {
    __typename: 'GraphqlSoupDocument',
    id: 'document-1',
    documentName: 'Document',
    ownerId: 'user-1',
    fileType: 'md',
    createdAt,
    updatedAt: createdAt,
    viewedAt: null,
    deletedAt: null,
    subType: null,
    ...overrides,
  };
}

function chat(
  overrides: Partial<GraphqlChatHistoryFieldsFragment> = {}
): GraphqlChatHistoryFieldsFragment {
  return {
    __typename: 'GraphqlSoupChat',
    id: 'chat-1',
    chatName: 'Chat',
    ownerId: 'user-1',
    isPersistent: true,
    createdAt,
    updatedAt: createdAt,
    viewedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function project(
  overrides: Partial<GraphqlProjectHistoryFieldsFragment> = {}
): GraphqlProjectHistoryFieldsFragment {
  return {
    __typename: 'GraphqlSoupProject',
    id: 'project-1',
    projectName: 'Project',
    ownerId: 'user-1',
    createdAt,
    updatedAt: createdAt,
    viewedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function cacheHost(
  readRecords: (args: ReadRecordsArgs) => Promise<unknown>
): Pick<CacheHost, 'readRecords'> {
  return { readRecords } as Pick<CacheHost, 'readRecords'>;
}

describe('cached GraphQL history', () => {
  it('scans only minimal concrete history types, paginates, filters deleted items, and preserves ordering', async () => {
    const readRecords = vi.fn(async (args: ReadRecordsArgs) => {
      switch (args.fragmentName) {
        case 'GraphqlDocumentHistoryFields':
          return args.cursor
            ? {
                records: [
                  document({
                    id: 'document-older',
                    documentName: 'Older document',
                    updatedAt: '2025-01-03T00:00:00.000Z',
                    subType: {
                      __typename: 'GraphqlTaskSubType',
                      isCompleted: true,
                    },
                  }),
                ],
                nextCursor: null,
              }
            : {
                records: [
                  document({
                    id: 'document-newest',
                    documentName: 'Newest document',
                    viewedAt: '2025-01-05T00:00:00.000Z',
                  }),
                ],
                nextCursor: 'document-cursor',
              };
        case 'GraphqlChatHistoryFields':
          return {
            records: [
              chat({
                id: 'chat-middle',
                updatedAt: '2025-01-04T00:00:00.000Z',
              }),
            ],
            nextCursor: null,
          };
        case 'GraphqlProjectHistoryFields':
          return {
            records: [
              project({
                id: 'project-deleted',
                viewedAt: '2025-01-06T00:00:00.000Z',
                deletedAt: '2025-01-06T00:00:00.000Z',
              }),
            ],
            nextCursor: null,
          };
        default:
          throw new Error(`unexpected fragment ${args.fragmentName}`);
      }
    });

    const result = await readCachedGraphqlHistoryItems(cacheHost(readRecords));

    expect(result.map(({ id }) => id)).toEqual([
      'document-newest',
      'chat-middle',
      'document-older',
    ]);
    expect(result[2]).toMatchObject({
      type: 'document',
      subType: { type: 'task', is_completed: true },
    });

    const initialCalls = readRecords.mock.calls
      .map(([args]) => args)
      .filter(({ cursor }) => cursor === undefined);
    expect(initialCalls.map(({ fragmentName }) => fragmentName).sort()).toEqual(
      [
        'GraphqlChatHistoryFields',
        'GraphqlDocumentHistoryFields',
        'GraphqlProjectHistoryFields',
      ]
    );

    const expectedRoots = {
      GraphqlChatHistoryFields: 'GraphqlSoupChat',
      GraphqlDocumentHistoryFields: 'GraphqlSoupDocument',
      GraphqlProjectHistoryFields: 'GraphqlSoupProject',
    } as const;
    for (const { document, fragmentName } of initialCalls) {
      expect(document).toContain(
        `fragment ${fragmentName} on ${expectedRoots[fragmentName as keyof typeof expectedRoots]}`
      );
      expect(document).not.toContain('GraphqlSoupEntity');
      expect(document).not.toMatch(
        /\b(properties|notifications|participants|messages|entityType|frecencyScore)\b/
      );
    }
  });

  it('rejects a repeated cursor from any concrete history scan', async () => {
    const readRecords = vi.fn(async (args: ReadRecordsArgs) => ({
      records: [],
      nextCursor:
        args.fragmentName === 'GraphqlDocumentHistoryFields'
          ? 'repeated-cursor'
          : null,
    }));

    await expect(
      readCachedGraphqlHistoryItems(cacheHost(readRecords))
    ).rejects.toThrow('cache record selection returned a repeated cursor');
  });
});
