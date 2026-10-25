import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  showPaywall: vi.fn(),
  metadata: vi.fn(),
  edit: vi.fn(),
  trash: vi.fn(),
  restore: vi.fn(),
  permanent: vi.fn(),
  copy: vi.fn(),
  removeHistory: vi.fn(),
  mutation: vi.fn(),
  refresh: vi.fn(),
  resources: vi.fn(),
  removeDeleted: vi.fn(),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@core/constant/PaywallState', () => ({
  usePaywallState: () => ({ showPaywall: mocks.showPaywall }),
}));
vi.mock('@queries/history/history', () => ({
  removeHistoryItem: mocks.removeHistory,
}));
vi.mock('@queries/storage/deleted', () => ({
  getDeletedTree: () => ({ itemMap: {} }),
  optimisticallyRemoveDeletedItem: mocks.removeDeleted,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));
vi.mock('@service-storage/util/refetchResources', () => ({
  refetchResources: mocks.resources,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getEntityGraphqlClient: () => ({ mutation: mocks.mutation }),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentMetadata: mocks.metadata,
    editDocument: mocks.edit,
    deleteDocument: mocks.trash,
    revertDocumentDelete: mocks.restore,
    permanentlyDeleteDocument: mocks.permanent,
    copyDocument: mocks.copy,
    projects: {
      getProject: mocks.metadata,
      edit: mocks.edit,
      delete: mocks.trash,
      revertDelete: mocks.restore,
      permanentlyDelete: mocks.permanent,
    },
  },
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    getChat: mocks.metadata,
    editChatProject: mocks.edit,
    deleteChat: mocks.trash,
    revertDeleteChat: mocks.restore,
    permanentlyDeleteChat: mocks.permanent,
    copyChat: mocks.copy,
  },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { updateThreadProject: mocks.edit },
}));
vi.mock('@service-call/client', () => ({ callServiceClient: {} }));

import { getOperationAST } from 'graphql';
import {
  copyItem,
  deleteItem,
  moveToFolder,
  permanentlyDelete,
  revertDelete,
} from './itemOperations';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
  mocks.metadata.mockResolvedValue(ok({ userAccessLevel: 'owner' }));
  for (const fn of [mocks.edit, mocks.trash, mocks.restore, mocks.permanent])
    fn.mockResolvedValue(ok(undefined));
  mocks.copy.mockResolvedValue(ok({ documentId: 'copy', id: 'copy' }));
  mocks.removeHistory.mockResolvedValue(true);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.mutation.mockImplementation((document) => ({
    toPromise: async () => {
      const operation = getOperationAST(document)?.name?.value ?? '';
      const field = operation[0].toLowerCase() + operation.slice(1);
      return {
        data: {
          [field]: {
            results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
          },
        },
      };
    },
  }));
});

function variables() {
  return mocks.mutation.mock.calls[0][1];
}

describe('flagged entity callers', () => {
  it.each([
    ['document', 'DOCUMENT'],
    ['chat', 'CHAT'],
    ['project', 'PROJECT'],
    ['email', 'EMAIL_THREAD'],
  ] as const)(
    'moves %s to a folder and root without REST preflights',
    async (itemType, type) => {
      for (const folderId of ['folder', null]) {
        mocks.mutation.mockClear();
        expect(await moveToFolder({ itemType, id: 'source', folderId })).toBe(
          true
        );
        expect(variables()).toEqual({
          inputs: [{ entity: { type, id: 'source' }, projectId: folderId }],
        });
      }
      expect(mocks.edit).not.toHaveBeenCalled();
      expect(mocks.metadata).not.toHaveBeenCalled();
    }
  );

  it.each(['document', 'chat', 'project'] as const)(
    'trashes/restores/permanently deletes %s through GraphQL',
    async (itemType) => {
      expect(await deleteItem({ itemType, id: 'source' })).toBe(true);
      expect(await revertDelete({ itemType, id: 'source' })).toBe(true);
      expect(await permanentlyDelete({ itemType, id: 'source' })).toBe(true);
      expect(
        mocks.mutation.mock.calls.map(
          ([doc]) => getOperationAST(doc)?.name?.value
        )
      ).toEqual([
        'TrashEntities',
        'RestoreEntities',
        'DeleteEntitiesPermanently',
      ]);
      expect(mocks.trash).not.toHaveBeenCalled();
      expect(mocks.restore).not.toHaveBeenCalled();
      expect(mocks.permanent).not.toHaveBeenCalled();
    }
  );

  it('keeps non-owner deletion as a history removal', async () => {
    mocks.metadata.mockResolvedValue(ok({ userAccessLevel: 'edit' }));
    expect(await deleteItem({ itemType: 'document', id: 'shared' })).toBe(true);
    expect(mocks.removeHistory).toHaveBeenCalledWith('document', 'shared');
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(mocks.trash).not.toHaveBeenCalled();
  });

  it.each(['document', 'chat'] as const)(
    'opens the new %s identity returned by duplicate effects',
    async (itemType) => {
      mocks.mutation.mockReturnValue({
        toPromise: async () => ({
          data: {
            duplicateEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationSuccess',
                  effects: [
                    {
                      __typename: 'SoupUpdated',
                      item: {
                        __typename:
                          itemType === 'document'
                            ? 'GraphqlSoupDocument'
                            : 'GraphqlSoupChat',
                        id: 'new-copy',
                      },
                    },
                  ],
                },
              ],
            },
          },
        }),
      });
      expect(await copyItem({ itemType, id: 'source', name: 'Original' })).toBe(
        'new-copy'
      );
      expect(variables()).toEqual({
        inputs: [
          {
            entity: {
              type: itemType === 'document' ? 'DOCUMENT' : 'CHAT',
              id: 'source',
            },
            displayName: itemType === 'document' ? 'Original copy' : undefined,
          },
        ],
      });
      expect(mocks.copy).not.toHaveBeenCalled();
      expect(mocks.showPaywall).not.toHaveBeenCalled();
    }
  );

  it.each([
    [true, 'chat', 'FORBIDDEN', 1],
    [false, 'chat', 'FORBIDDEN', 1],
    [true, 'document', 'FORBIDDEN', 0],
    [false, 'document', 'FORBIDDEN', 0],
    [true, 'chat', 'NOT_FOUND', 0],
    [true, 'chat', 'INTERNAL', 0],
  ] as const)(
    'preserves copy paywall behavior (graphql=%s, item=%s, error=%s)',
    async (graphql, itemType, errorCode, paywallCalls) => {
      mocks.graphql = graphql;
      mocks.mutation.mockReturnValue({
        toPromise: async () => ({
          data: {
            duplicateEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationError',
                  errorCode,
                  message: 'Copy refused',
                },
              ],
            },
          },
        }),
      });
      mocks.copy.mockResolvedValue(
        err([{ code: errorCode, message: 'Copy refused' }])
      );

      expect(
        await copyItem({ itemType, id: 'source', name: 'Original' })
      ).toBeNull();
      expect(mocks.showPaywall).toHaveBeenCalledTimes(paywallCalls);
      expect(mocks.mutation).toHaveBeenCalledTimes(graphql ? 1 : 0);
      expect(mocks.copy).toHaveBeenCalledTimes(graphql ? 0 : 1);
      expect(mocks.resources).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    }
  );

  it('preserves every REST path when the flag is disabled', async () => {
    mocks.graphql = false;
    expect(
      await moveToFolder({ itemType: 'document', id: 'source', folderId: null })
    ).toBe(true);
    expect(await deleteItem({ itemType: 'document', id: 'source' })).toBe(true);
    expect(await revertDelete({ itemType: 'document', id: 'source' })).toBe(
      true
    );
    expect(
      await permanentlyDelete({ itemType: 'document', id: 'source' })
    ).toBe(true);
    expect(
      await copyItem({ itemType: 'document', id: 'source', name: 'Original' })
    ).toBe('copy');
    expect(mocks.edit).toHaveBeenCalledWith({
      documentId: 'source',
      projectId: '',
    });
    for (const fn of [mocks.trash, mocks.restore, mocks.permanent, mocks.copy])
      expect(fn).toHaveBeenCalledOnce();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it('does not convert a forbidden GraphQL write into a REST retry or success', async () => {
    mocks.mutation.mockReturnValue({
      toPromise: async () => ({
        data: {
          moveEntities: {
            results: [
              {
                __typename: 'GraphqlMutationError',
                errorCode: 'FORBIDDEN',
                message: 'Denied',
              },
            ],
          },
        },
      }),
    });
    expect(
      await moveToFolder({
        itemType: 'document',
        id: 'source',
        folderId: 'folder',
      })
    ).toBe(false);
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.resources).not.toHaveBeenCalled();
  });

  it('keeps REST permission failures unchanged', async () => {
    mocks.graphql = false;
    mocks.metadata.mockResolvedValue(
      err([{ code: 'FORBIDDEN', message: 'Denied' }])
    );
    expect(
      await moveToFolder({ itemType: 'document', id: 'source', folderId: null })
    ).toBe(false);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
});
