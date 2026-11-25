import {
  invalidateDeletedItems,
  useDeletedItemsInfiniteQuery,
} from '@queries/storage/deleted';
import {
  permanentlyDeleteEntity,
  restoreEntity,
} from '@queries/storage/entity-mutations';
import { refreshActiveGraphqlFoldersQueries } from '@queries/storage/graphql-folders';
import type { Item } from '@service-storage/generated/schemas/item';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type { DriveTrashItem, DriveTrashItemType } from '../core/drive-trash';

const GRAPHQL_TRASH_ENTITY_TYPE = {
  document: 'DOCUMENT',
  project: 'PROJECT',
  chat: 'CHAT',
} as const;

export function toDriveTrashItem(item: Item): DriveTrashItem | undefined {
  return match(item)
    .with({ type: 'document' }, (doc) => ({
      id: doc.id,
      itemType: 'document' as const,
      name: doc.name,
      fileType: doc.fileType ?? undefined,
      subType: doc.subType?.type,
      deletedAt: doc.deletedAt ?? null,
      updatedAt: doc.updatedAt ?? null,
      parentFolderId: doc.projectId ?? null,
      ownerId: doc.owner,
    }))
    .with({ type: 'project' }, (project) => ({
      id: project.id,
      itemType: 'project' as const,
      name: project.name,
      deletedAt: project.deletedAt ?? null,
      updatedAt: project.updatedAt ?? null,
      parentFolderId: project.parentId ?? null,
      ownerId: project.userId,
    }))
    .with({ type: 'chat' }, (chat) => ({
      id: chat.id,
      itemType: 'chat' as const,
      name: chat.name,
      deletedAt: chat.deletedAt ?? null,
      updatedAt: chat.updatedAt ?? null,
      parentFolderId: chat.projectId ?? null,
      ownerId: chat.userId,
    }))
    .exhaustive(() => undefined);
}

export type DriveTrashSource = {
  items: Accessor<DriveTrashItem[]>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  error: Accessor<unknown>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  restoreItems: (
    items: readonly { id: string; itemType: DriveTrashItemType }[]
  ) => Promise<{ restored: number; failed: number }>;
  permanentlyDeleteItems: (
    items: readonly { id: string; itemType: DriveTrashItemType }[]
  ) => Promise<{ deleted: number; failed: number }>;
};

export function createDriveTrashSource(
  enabled: Accessor<boolean>
): DriveTrashSource {
  const query = useDeletedItemsInfiniteQuery(enabled);

  const items = createMemo(() => {
    if (query.isPending) return [];
    const seen = new Set<string>();
    const rows: DriveTrashItem[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const raw of page.items) {
        const mapped = toDriveTrashItem(raw);
        if (!mapped) continue;
        const key = `${mapped.itemType}:${mapped.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(mapped);
      }
    }
    return rows;
  });

  const refreshAfterMutation = async (hasFolders: boolean) => {
    await Promise.allSettled([
      invalidateDeletedItems(),
      hasFolders ? refreshActiveGraphqlFoldersQueries() : Promise.resolve(),
    ]);
  };

  return {
    items,
    isLoading: () => query.isPending && items().length === 0,
    isFetching: () => query.isFetching,
    isLoadingMore: () => query.isFetchingNextPage,
    hasMore: () => Boolean(query.hasNextPage),
    error: () => query.error ?? undefined,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetchingNextPage) return;
      await query.fetchNextPage();
    },
    refresh: async () => {
      await query.refetch();
    },
    restoreItems: async (targets) => {
      const outcomes = await Promise.allSettled(
        targets.map((target) =>
          restoreEntity({
            type: GRAPHQL_TRASH_ENTITY_TYPE[target.itemType],
            id: target.id,
          })
        )
      );
      const restored = outcomes.filter((o) => o.status === 'fulfilled').length;
      const failed = outcomes.length - restored;
      if (restored > 0) {
        await refreshAfterMutation(
          targets.some((target) => target.itemType === 'project')
        );
      }
      return { restored, failed };
    },
    permanentlyDeleteItems: async (targets) => {
      const outcomes = await Promise.allSettled(
        targets.map((target) =>
          permanentlyDeleteEntity({
            type: GRAPHQL_TRASH_ENTITY_TYPE[target.itemType],
            id: target.id,
          })
        )
      );
      const deleted = outcomes.filter((o) => o.status === 'fulfilled').length;
      const failed = outcomes.length - deleted;
      if (deleted > 0) {
        await refreshAfterMutation(
          targets.some((target) => target.itemType === 'project')
        );
      }
      return { deleted, failed };
    },
  };
}
