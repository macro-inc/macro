import { err, errAsync, ok, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
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
  duplicateDatabase: vi.fn(),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@queries/history/history', () => ({
  removeHistoryItem: mocks.removeHistory,
}));
vi.mock('@queries/storage/databases', () => ({
  duplicateDatabase: mocks.duplicateDatabase,
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
  },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { updateThreadProject: mocks.edit },
}));
vi.mock('@service-call/client', () => ({ callServiceClient: {} }));

import { getOperationAST } from 'graphql';
import {
  canDuplicateItemType,
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

  it.each([
    ['database', 'DATABASE'],
    ['form', 'FORM'],
  ] as const)(
    'moves a %s through the entity mutation, its only route, with or without the GraphQL soup',
    async (itemType, type) => {
      for (const graphql of [true, false]) {
        mocks.graphql = graphql;
        for (const folderId of ['folder', null]) {
          mocks.mutation.mockClear();
          expect(await moveToFolder({ itemType, id: 'source', folderId })).toBe(
            true
          );
          expect(variables()).toEqual({
            inputs: [{ entity: { type, id: 'source' }, projectId: folderId }],
          });
        }
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

  it('opens the new document identity returned by duplicate effects', async () => {
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
                    item: { __typename: 'GraphqlSoupDocument', id: 'new-copy' },
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    expect(
      await copyItem({ itemType: 'document', id: 'source', name: 'Original' })
    ).toBe('new-copy');
    expect(variables()).toEqual({
      inputs: [
        {
          entity: { type: 'DOCUMENT', id: 'source' },
          displayName: 'Original copy',
        },
      ],
    });
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'does not duplicate legacy chats (GraphQL Soup %s)',
    async (graphql) => {
      mocks.graphql = graphql;
      expect(canDuplicateItemType('chat')).toBe(false);
      expect(
        await copyItem({ itemType: 'chat', id: 'source', name: 'Original' })
      ).toBeNull();
      expect(mocks.mutation).not.toHaveBeenCalled();
      expect(mocks.copy).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'duplicates a database through its own route, named like documents (GraphQL Soup %s)',
    async (graphql) => {
      mocks.graphql = graphql;
      mocks.duplicateDatabase.mockReturnValue(okAsync('database-copy'));

      expect(canDuplicateItemType('database')).toBe(true);
      expect(
        await copyItem({ itemType: 'database', id: 'source', name: 'Plans' })
      ).toBe('database-copy');

      expect(mocks.duplicateDatabase).toHaveBeenCalledWith({
        id: 'source',
        name: 'Plans copy',
      });
      expect(mocks.mutation).not.toHaveBeenCalled();
    }
  );

  it('answers a failed database duplicate with no copy', async () => {
    mocks.duplicateDatabase.mockReturnValue(
      errAsync([{ code: 'NOT_FOUND', message: 'gone' }])
    );

    expect(
      await copyItem({ itemType: 'database', id: 'source', name: 'Plans' })
    ).toBeNull();
  });

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
