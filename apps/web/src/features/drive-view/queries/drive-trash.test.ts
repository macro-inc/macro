import type { Item } from '@service-storage/generated/schemas/item';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  account: { userId: 'u1', session: 1 } as
    | { userId: string; session: number }
    | undefined,
  invalidateDeletedItems: vi.fn(async () => {}),
  restoreEntity: vi.fn(async () => {}),
  permanentlyDeleteEntity: vi.fn(async () => {}),
  refreshFolders: vi.fn(async () => {}),
  query: {
    isPending: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null as unknown,
    data: { pages: [] as { items: Item[] }[] },
    fetchNextPage: vi.fn(async () => {}),
    refetch: vi.fn(async () => {}),
  },
}));

vi.mock('@queries/auth/use-query-account', () => ({
  useQueryAccount: () => () => mocks.account,
}));

vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => mocks.account,
  isCurrentQueryAccount: (captured: { userId: string; session: number }) =>
    Boolean(
      mocks.account &&
        mocks.account.userId === captured.userId &&
        mocks.account.session === captured.session
    ),
}));

vi.mock('@queries/storage/deleted', () => ({
  invalidateDeletedItems: mocks.invalidateDeletedItems,
  useDeletedItemsInfiniteQuery: () => mocks.query,
}));

vi.mock('@queries/storage/entity-mutations', () => ({
  restoreEntity: mocks.restoreEntity,
  permanentlyDeleteEntity: mocks.permanentlyDeleteEntity,
}));

vi.mock('@queries/storage/graphql-folders', () => ({
  refreshActiveGraphqlFoldersQueries: mocks.refreshFolders,
}));

import { createDriveTrashSource, toDriveTrashItem } from './drive-trash';

describe('drive-trash query adapter', () => {
  it('maps deleted documents, folders, and chats into DriveTrashItem', () => {
    const doc = {
      type: 'document',
      id: 'd1',
      name: 'Launch Plan.md',
      fileType: 'md',
      subType: { type: 'skill' },
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      projectId: 'f1',
      owner: 'u1',
    } as unknown as Item;

    const folder = {
      type: 'project',
      id: 'f1',
      name: 'Launch',
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      parentId: 'f0',
      userId: 'u1',
    } as unknown as Item;

    const chat = {
      type: 'chat',
      id: 'c1',
      name: 'Design review',
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      projectId: null,
      userId: 'u1',
    } as unknown as Item;

    expect(toDriveTrashItem(doc)).toEqual({
      id: 'd1',
      itemType: 'document',
      name: 'Launch Plan.md',
      fileType: 'md',
      subType: 'skill',
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      parentFolderId: 'f1',
      ownerId: 'u1',
    });

    expect(toDriveTrashItem(folder)).toEqual({
      id: 'f1',
      itemType: 'project',
      name: 'Launch',
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      parentFolderId: 'f0',
      ownerId: 'u1',
    });

    expect(toDriveTrashItem(chat)).toEqual({
      id: 'c1',
      itemType: 'chat',
      name: 'Design review',
      deletedAt: '2026-05-15T08:00:00Z',
      updatedAt: '2026-05-14T12:00:00Z',
      parentFolderId: null,
      ownerId: 'u1',
    });

    expect(
      toDriveTrashItem({ type: 'unknown_future' } as unknown as Item)
    ).toBeUndefined();
  });

  it('restores and permanently deletes items while refreshing folders when needed', async () => {
    await createRoot(async (dispose) => {
      const source = createDriveTrashSource(() => true);

      const restored = await source.restoreItems([
        { id: 'd1', itemType: 'document' },
        { id: 'f1', itemType: 'project' },
      ]);
      expect(restored).toEqual({ restored: 2, failed: 0 });
      expect(mocks.restoreEntity).toHaveBeenCalledWith({
        type: 'DOCUMENT',
        id: 'd1',
      });
      expect(mocks.restoreEntity).toHaveBeenCalledWith({
        type: 'PROJECT',
        id: 'f1',
      });
      expect(mocks.invalidateDeletedItems).toHaveBeenCalledTimes(1);
      expect(mocks.refreshFolders).toHaveBeenCalledTimes(1);

      const deleted = await source.permanentlyDeleteItems([
        { id: 'c1', itemType: 'chat' },
      ]);
      expect(deleted).toEqual({ deleted: 1, failed: 0 });
      expect(mocks.permanentlyDeleteEntity).toHaveBeenCalledWith({
        type: 'CHAT',
        id: 'c1',
      });

      // Account pending hides items and blocks mutations cleanly.
      mocks.account = undefined;
      expect(source.items()).toEqual([]);
      expect(source.isLoading()).toBe(true);
      const blocked = await source.restoreItems([
        { id: 'd1', itemType: 'document' },
      ]);
      expect(blocked).toEqual({ restored: 0, failed: 1 });
      mocks.account = { userId: 'u1', session: 1 };

      dispose();
    });
  });
});
