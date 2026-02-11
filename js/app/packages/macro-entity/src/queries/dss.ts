import {
  copyItem,
  deleteItem,
  moveToFolder,
} from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { SoupPage } from '@service-storage/generated/schemas/soupPage';
import { type InfiniteData, useMutation } from '@tanstack/solid-query';
import type { EntityData } from '../types/entity';
import { queryClient } from './client';
import { soupKeys } from '@queries/soup/keys';

const getSoupItemId = (item: SoupApiItem): string => {
  switch (item.tag) {
    case 'channel':
      return item.data.channel.id;
    default:
      return item.data.id;
  }
};

export function createDeleteDssItemMutation() {
  return useMutation(() => ({
    mutationFn: async ({ id, type }: EntityData) => {
      const success = await deleteItem({ id, itemType: type });
      return { success };
    },
    onMutate: async ({ id }: EntityData) => {
      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });

      function removeEntityFromQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
        const pages = prev.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== id),
        }));
        return {
          ...prev,
          pages,
        };
      }
      queryClient.setQueriesData({ queryKey: soupKeys.items._def }, (prev) =>
        removeEntityFromQueryData(
          prev as { pages: { items: EntityData[] }[] } | undefined
        )
      );
    },
    onSettled: (data, error, entity) => {
      if (data?.success === false || error) {
        console.error(`Failed to delete dss item ${entity}`, data, error);
        toast.failure('Failed to delete item');
      }

      queryClient.invalidateQueries({
        queryKey: soupKeys.items._def,
      });
    },
  }));
}

export function createBulkDeleteDssItemsMutation() {
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document' && type !== 'project';
  };
  return useMutation(() => ({
    mutationFn: async (entities: EntityData[]) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity types`);
      }

      return await Promise.all(
        entities.map((e) => {
          return deleteItem({ id: e.id, itemType: e.type });
        })
      );
    },
    onMutate: async (entities: EntityData[]) => {
      const deletedIDs = entities.map((e) => e.id);

      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });
      queryClient.cancelQueries({
        queryKey: soupKeys.search._def,
      });

      function removeEntitiesFromQueryData(
        prev: InfiniteData<SoupPage, unknown> | undefined
      ): InfiniteData<SoupPage, unknown> | undefined {
        if (!prev) return prev;
        const pages = prev.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => {
            const itemId = getSoupItemId(item);
            return !deletedIDs.includes(itemId);
          }),
        }));
        return {
          ...prev,
          pages,
        };
      }

      function getSearchResultId(result: UnifiedSearchResponseItem): string {
        switch (result.type) {
          case 'document':
            return result.document_id;
          case 'chat':
            return result.chat_id;
          case 'channel':
            return result.channel_id;
          case 'email':
            return result.thread_id;
          case 'project':
            return result.id;
        }
      }

      function removeEntitiesFromSearchData(
        prev:
          | InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
          | undefined
      ):
        | InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
        | undefined {
        if (!prev) return prev;
        const pages = prev.pages.map((page) => ({
          ...page,
          results: page.results.filter((result) => {
            const id = getSearchResultId(result);
            return !deletedIDs.includes(id);
          }),
        }));
        return {
          ...prev,
          pages,
        };
      }

      queryClient.setQueriesData({ queryKey: soupKeys.items._def }, (prev) =>
        removeEntitiesFromQueryData(
          prev as InfiniteData<SoupPage, unknown> | undefined
        )
      );

      queryClient.setQueriesData({ queryKey: soupKeys.search._def }, (prev) =>
        removeEntitiesFromSearchData(
          prev as
            | InfiniteData<{ results: UnifiedSearchResponseItem[] }, unknown>
            | undefined
        )
      );
    },
    onError: (error, entities, _context) => {
      console.error(`Failed to delete dss items`, entities, error);
      toast.failure('Failed to delete items');
      // Rollback on error - restore the deleted items
      queryClient.invalidateQueries({
        queryKey: soupKeys.items._def,
      });
      queryClient.invalidateQueries({
        queryKey: soupKeys.search._def,
      });
    },
  }));
}

function createMoveOptimisticUpdate(entityIds: string[], projectId: string) {
  return (
    prev: { pages: { items: EntityData[] }[] } | undefined
  ): { pages: { items: EntityData[] }[] } | undefined => {
    if (!prev) return prev;
    const pages = prev.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        entityIds.includes(item.id) ? { ...item, projectId } : item
      ),
    }));
    return {
      ...prev,
      pages,
    };
  };
}

function invalidateAfterMove(hasProjects: boolean, failed?: boolean) {
  if (failed) {
    toast.failure('Failed to move item');
  }

  queryClient.invalidateQueries({
    queryKey: soupKeys.items._def,
  });
  queryClient.invalidateQueries({ queryKey: ['entity'] });
  // If moving a project, invalidate all project queries since nested projects' breadcrumbs change too
  if (hasProjects) {
    queryClient.invalidateQueries({
      queryKey: ['project'],
    });
  }
}

export function createMoveToProjectDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type },
      project: { id: projectId },
    }: {
      entity: EntityData & { type: 'document' | 'chat' | 'project' };
      project: { id: string };
    }) => {
      const success = await moveToFolder({
        itemType: type,
        id,
        folderId: projectId,
      });

      return { success };
    },
    onMutate: async ({
      entity: { id, type },
      project: { id: projectId },
    }: {
      entity: EntityData & { type: 'document' | 'chat' | 'project' };
      project: { id: string };
    }) => {
      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });

      // Only do optimistic updates for documents and chats
      // Projects have complex path data that we can't compute client-side
      if (type !== 'project') {
        queryClient.setQueriesData(
          { queryKey: soupKeys.items._def },
          createMoveOptimisticUpdate([id], projectId)
        );
      }
    },
    onSettled: (data, error, { entity: { id, type } }) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        console.error(`Failed to move dss item ${id}`, data, error);
      }

      invalidateAfterMove(type === 'project', failed);
    },
  }));
}

export function createCopyDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type, name },
    }: {
      entity: EntityData & { type: 'document' | 'chat' };
    }) => {
      const newId = await copyItem({
        itemType: type,
        id,
        name,
      });

      if (!newId) {
        throw new Error(`Failed to copy ${type} with id ${id}`);
      }

      return newId;
    },
    onMutate: async () => {
      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });
      // For copy operations, we don't need optimistic updates since we're creating a new item
      // The new item will be added when the mutation completes and queries are invalidated
    },
    onSettled: (data, error, { entity: { id } }) => {
      if (error) {
        console.error(`Failed to copy dss item ${id}`, data, error);
        toast.failure('Failed to copy item');
      }
      queryClient.invalidateQueries({
        queryKey: soupKeys.items._def,
      });
      queryClient.invalidateQueries({ queryKey: ['entity'] });
    },
  }));
}

export function createBulkCopyDssEntityMutation() {
  // Only support chat + document, same as single-copy version
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      name,
    }: {
      entities: (EntityData & { name: string })[];
      name: string | ((oldName: string) => string);
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((e) =>
          copyItem({
            itemType: e.type as 'document' | 'chat',
            id: e.id,
            name: typeof name === 'function' ? name(e.name) : name,
          })
        )
      );

      if (results.some((r) => !r)) {
        throw new Error(`One or more DSS items failed to copy`);
      }

      return { success: true };
    },

    onMutate: async () => {
      // For copy, no optimistic update — new IDs unknown until server
      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });
    },

    onSettled: (data, error, { entities }) => {
      if (error) {
        console.error(`Failed bulk copy`, entities, data, error);
        toast.failure('Failed to copy items');
      }

      // Trigger refetch so new items appear
      queryClient.invalidateQueries({
        queryKey: soupKeys.items._def,
      });
      queryClient.invalidateQueries({ queryKey: ['entity'] });
    },
  }));
}

export function createBulkMoveToProjectDssEntityMutation() {
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document' && type !== 'project';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      project,
    }: {
      entities: (EntityData & { name: string })[];
      project: { id: string; name: string };
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((entity) =>
          moveToFolder({
            itemType: entity.type as 'document' | 'chat' | 'project',
            id: entity.id,
            folderId: project.id,
          })
        )
      );

      if (results.some((r) => !r)) {
        throw new Error(`One or more DSS items failed to move`);
      }

      return { success: true };
    },

    onMutate: async ({
      entities,
      project,
    }: {
      entities: (EntityData & { name: string })[];
      project: { id: string; name: string };
    }) => {
      queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });

      // Only do optimistic updates for documents and chats
      // Projects have complex path data that we can't compute client-side
      const nonProjectIds = entities
        .filter((e) => e.type !== 'project')
        .map((e) => e.id);

      if (nonProjectIds.length > 0) {
        queryClient.setQueriesData(
          { queryKey: soupKeys.items._def },
          createMoveOptimisticUpdate(nonProjectIds, project.id)
        );
      }
    },

    onSettled: (data, error, { entities }) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        console.error(`Failed to bulk move dss items`, entities, data, error);
      }

      invalidateAfterMove(
        entities.some((e) => e.type === 'project'),
        failed
      );
    },
  }));
}

/**
 * Optimistically update the viewedAt timestamp for a DSS item.
 * Updates the item across all DSS queries if it exists.
 */
export function optimisticUpdateDssItemViewedAt(itemId: string) {
  const now = new Date();

  queryClient.setQueriesData(
    { queryKey: soupKeys.items._def },
    (prev: InfiniteData<SoupPage, unknown> | undefined) => {
      if (!prev) return prev;

      const pages = prev.pages.map((page) => {
        return {
          ...page,
          items: page.items.map((item): SoupApiItem => {
            const currentItemId = getSoupItemId(item);
            if (currentItemId !== itemId) return item;

            switch (item.tag) {
              case 'document':
              case 'chat':
              case 'project':
              case 'emailThread':
                item.data.viewedAt = now;
                break;
              case 'channel':
                item.data.viewed_at = now;
                break;
            }

            return item;
          }),
        };
      });

      return {
        ...prev,
        pages,
      };
    }
  );
}

/** Finds a soup item in the cache and returns its location. */
export function hasSoupItem(itemId: string) {
  const queries = queryClient.getQueriesData<InfiniteData<SoupPage, unknown>>({
    queryKey: soupKeys.items._def,
  });

  for (const [, data] of queries) {
    if (!data) continue;

    for (let pageIndex = 0; pageIndex < data.pages.length; pageIndex++) {
      const page = data.pages[pageIndex];
      const itemIndex = page.items.findIndex(
        (item) => getSoupItemId(item) === itemId
      );
      if (itemIndex >= 0) return true;
    }
  }

  return false;
}

/**
 * Invalidates all DSS soup queries, marking them as stale.
 * If the query is currently being rendered, it will also be refetched in the background
 */
export function invalidateSoup() {
  queryClient.invalidateQueries({
    queryKey: soupKeys.items._def,
  });
}
