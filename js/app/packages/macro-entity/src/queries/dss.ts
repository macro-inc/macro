import {
  copyItem,
  deleteItem,
  moveToFolder,
} from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import { useMutation } from '@tanstack/solid-query';
import type { EntityData } from '@entity';
import { queryClient } from '@queries/client';
import { soupKeys } from '@queries/soup/keys';
import {
  removeSoupEntities,
  removeSearchEntities,
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  invalidateSoupEntity,
} from '@queries/soup/cache';

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
        entities
          .filter((e) => e.type !== 'channel_message')
          .map((e) => {
            return deleteItem({ id: e.id, itemType: e.type });
          })
      );
    },
    onMutate: async (entities: EntityData[]) => {
      const ids = new Set(entities.map((e) => e.id));
      const soupSnapshot = removeSoupEntities(ids);
      const searchSnapshot = removeSearchEntities(ids);
      return { soupSnapshot, searchSnapshot };
    },
    onError: (error, entities, context) => {
      context?.soupSnapshot.rollback();
      context?.searchSnapshot.rollback();
      console.error(`Failed to delete dss items`, entities, error);
      toast.failure('Failed to delete items');
    },
  }));
}

function invalidateAfterMove(
  entityIds: string[],
  hasProjects: boolean,
  failed?: boolean
) {
  if (failed) {
    toast.failure('Failed to move item');
  }

  for (const id of entityIds) {
    invalidateSoupEntity(id);
  }
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
      if (type !== 'project') {
        const current = getSoupEntityById(id);
        return optimisticUpdateSoupEntity({
          tag: type,
          data: { id, projectId },
          frecency_score: current?.frecency_score ?? 0,
        });
      }
    },
    onSettled: (data, error, { entity: { id, type } }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        context?.rollback();
        console.error(`Failed to move dss item ${id}`, data, error);
      }

      invalidateAfterMove([id], type === 'project', failed);
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
    return (
      type !== 'chat' &&
      type !== 'document' &&
      type !== 'project' &&
      type !== 'email'
    );
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
            itemType: entity.type as 'document' | 'chat' | 'project' | 'email',
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
      const moveableEntities = entities.filter(
        (e): e is typeof e & { type: 'document' | 'chat' | 'email' } =>
          e.type === 'document' || e.type === 'chat' || e.type === 'email'
      );
      return moveableEntities.map((e) => {
        const current = getSoupEntityById(e.id);
        const tag = e.type === 'email' ? 'emailThread' : e.type;
        return optimisticUpdateSoupEntity({
          tag,
          data: { id: e.id, projectId: project.id },
          frecency_score: current?.frecency_score ?? 0,
        });
      });
    },

    onSettled: (data, error, { entities }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        context?.forEach((txn) => txn.rollback());
        console.error(`Failed to bulk move dss items`, entities, data, error);
      }

      invalidateAfterMove(
        entities.map((e) => e.id),
        entities.some((e) => e.type === 'project'),
        failed
      );
    },
  }));
}
