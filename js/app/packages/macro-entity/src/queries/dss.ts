import {
  copyItem,
  deleteItem,
  moveToFolder,
} from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { type EntityData, getEntityProjectId } from '@entity';
import { scheduledActionKeys } from '@queries/agent-schedule/keys';
import { callKeys } from '@queries/call/keys';
import { queryClient } from '@queries/client';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  invalidateSoupQueriesReferencing,
  optimisticUpdateSoupEntity,
  removeSearchEntities,
  removeSoupEntities,
  removeSoupEntitiesFromQueriesReferencing,
} from '@queries/soup/cache';
import { soupKeys } from '@queries/soup/keys';
import { callServiceClient } from '@service-call/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { ItemType } from '@service-storage/client';
import { useMutation } from '@tanstack/solid-query';

export function createBulkDeleteDssItemsMutation() {
  const isDeletable = (entity: EntityData) => {
    const type = entity.type;
    return (
      type === 'chat' ||
      type === 'document' ||
      type === 'project' ||
      type === 'call' ||
      type === 'automation'
    );
  };
  return useMutation(() => ({
    mutationFn: async (entities: EntityData[]) => {
      const deletable = entities.filter(isDeletable);
      const results = await Promise.all(
        deletable.map((e) => {
          if (e.type === 'call') {
            return throwOnErr(() =>
              callServiceClient.deleteCallRecord(e.id)
            ).then(() => true);
          }
          if (e.type === 'automation') {
            return throwOnErr(() =>
              scheduledActionClient.deleteSchedule({ scheduleId: e.id })
            ).then(() => true);
          }
          return deleteItem({ id: e.id, itemType: e.type as ItemType });
        })
      );
      if (deletable.some((e) => e.type === 'call')) {
        queryClient.invalidateQueries({ queryKey: callKeys._def });
      }
      if (deletable.some((e) => e.type === 'automation')) {
        const deletedIds = new Set(
          deletable.filter((e) => e.type === 'automation').map((e) => e.id)
        );
        queryClient.setQueryData(
          scheduledActionKeys.list.queryKey,
          (current: unknown) => {
            if (!Array.isArray(current)) return current;
            return current.filter(
              (item: { id?: string }) => !item.id || !deletedIds.has(item.id)
            );
          }
        );
        queryClient.invalidateQueries({
          queryKey: scheduledActionKeys.list.queryKey,
        });
      }
      return results;
    },
    onMutate: async (entities: EntityData[]) => {
      const deletable = entities.filter(isDeletable);
      const ids = new Set(deletable.map((e) => e.id));
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
  destinationProjectId: string,
  hasProjects: boolean,
  failed?: boolean
) {
  if (failed) {
    toast.failure('Failed to move item');
  }

  // Covers queries already containing the entities (including the source folder's list)
  for (const id of entityIds) {
    invalidateSoupEntity(id);
  }
  // Destination folder's list queries don't contain the entities yet, so match by project id in the key
  invalidateSoupQueriesReferencing([destinationProjectId]);
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
    onSettled: (data, error, { entity: { id, type }, project }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        context?.rollback();
        console.error(`Failed to move dss item ${id}`, data, error);
      }

      invalidateAfterMove([id], project.id, type === 'project', failed);
    },
  }));
}

export function createBulkRemoveFromProjectDssEntityMutation() {
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
    mutationFn: async ({ entities }: { entities: EntityData[] }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((entity) =>
          moveToFolder({
            itemType: entity.type as 'document' | 'chat' | 'project' | 'email',
            id: entity.id,
            folderId: null,
          })
        )
      );

      if (results.some((r) => !r)) {
        throw new Error(`One or more DSS items failed to move`);
      }

      return { success: true };
    },

    onMutate: async ({ entities }: { entities: EntityData[] }) => {
      const moveableEntities = entities.filter(
        (e): e is typeof e & { type: 'document' | 'chat' | 'email' } =>
          e.type === 'document' || e.type === 'chat' || e.type === 'email'
      );
      const txns = moveableEntities.map((e) => {
        const current = getSoupEntityById(e.id);
        const tag = e.type === 'email' ? 'emailThread' : e.type;
        return optimisticUpdateSoupEntity({
          tag,
          data: { id: e.id, projectId: null },
          frecency_score: current?.frecency_score ?? 0,
        });
      });

      // Drop the rows from the source folders' views right away; other views
      // keep the entities
      const sourceProjectIds = [
        ...new Set(
          entities.flatMap((e) => {
            const projectId =
              getEntityProjectId(e) || getSoupEntityProjectId(e.id);
            return projectId ? [projectId] : [];
          })
        ),
      ];
      txns.push(
        removeSoupEntitiesFromQueriesReferencing(
          new Set(entities.map((e) => e.id)),
          sourceProjectIds
        )
      );

      return { txns, sourceProjectIds };
    },

    onSettled: (data, error, { entities }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        // Reverse order: each txn's snapshot captures the previous txns' writes
        context?.txns.toReversed().forEach((txn) => txn.rollback());
        console.error(
          `Failed to remove dss items from folder`,
          entities,
          error
        );
        toast.failure('Failed to remove items from folder');
      }

      // Queries still containing the entities
      for (const entity of entities) {
        invalidateSoupEntity(entity.id);
      }
      // The source folders' views no longer contain the entities after the
      // optimistic removal, so match them by project id in the key
      invalidateSoupQueriesReferencing(context?.sourceProjectIds ?? []);
      queryClient.invalidateQueries({ queryKey: ['entity'] });
      // Removed projects' breadcrumbs (and nested projects') change too
      if (entities.some((e) => e.type === 'project')) {
        queryClient.invalidateQueries({ queryKey: ['project'] });
      }
    },
  }));
}

/** Source project of a soup-cached entity ('project' items nest it as parentId). */
function getSoupEntityProjectId(entityId: string): string | undefined {
  const cached = getSoupEntityById(entityId);
  if (!cached) return undefined;
  if (cached.tag === 'project') return cached.data.parentId ?? undefined;
  if ('projectId' in cached.data) return cached.data.projectId ?? undefined;
  return undefined;
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
      queryClient.cancelQueries({
        queryKey: soupKeys.astItems._def,
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
      queryClient.invalidateQueries({
        queryKey: soupKeys.astItems._def,
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

    onSettled: (data, error, { entities, project }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        context?.forEach((txn) => txn.rollback());
        console.error(`Failed to bulk move dss items`, entities, data, error);
      }

      invalidateAfterMove(
        entities.map((e) => e.id),
        project.id,
        entities.some((e) => e.type === 'project'),
        failed
      );
    },
  }));
}
