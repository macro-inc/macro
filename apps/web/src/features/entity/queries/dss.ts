import { Telemetry, type TraceContext } from '@macro-inc/observability';
/** Document-storage mutations used by entity surfaces. */

import { databaseEntityMessage } from '@app/features/database/core/write-failure';
import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { scheduledActionKeys } from '@app/features/routines/queries/keys';
import { trashDatabase } from '@block-database/queries/trash-database';
import {
  canDuplicateItemType,
  copyItem,
  deleteItem,
  moveToFolder,
} from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { deleteAgentSession } from '@queries/agent-session/entity-mutations';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
  QueryAccountChangedError,
  queryAccountSession,
} from '@queries/auth/account-scope';
import { callKeys } from '@queries/call/keys';
import { refreshChannelDirectory } from '@queries/channel/directory';
import { channelKeys } from '@queries/channel/keys';
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
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupEntityKey } from '@queries/soup/graphql/entity-input';
import {
  createGraphqlSoupDeletion,
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
  GRAPHQL_SOUP_DELETE_RETENTION_MS,
} from '@queries/soup/graphql/optimistic-deletions';
import { recoverActiveGraphqlSoupQueries } from '@queries/soup/graphql/recover-queries';
import { soupKeys } from '@queries/soup/keys';
import { ownTouchStamp } from '@queries/soup/normalized-cache/own-touch';
import {
  type OnSoupDeletion,
  permanentlyDeleteEntity,
} from '@queries/storage/entity-mutations';
import { databasesKeys, formsKeys } from '@queries/storage/keys';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { ListedForm } from '@service-storage/generated/schemas/listedForm';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import {
  type MutationFunctionContext,
  useMutation,
} from '@tanstack/solid-query';
import { batch } from 'solid-js';
import { type EntityData, getEntityProjectId } from '../types/entity';
import { BulkDeleteFailure } from './bulk-delete-result';

function invalidateDeletedDssItems(
  entities: EntityData[],
  writer: QueryAccount | undefined
): void {
  // A deleted folder's databases and forms return to the root on the server.
  if (entities.some((e) => e.type === 'project')) {
    queryClient.invalidateQueries({ queryKey: databasesKeys.list.queryKey });
    queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey });
  }
  const channelIds = entities.flatMap((e) =>
    e.type === 'channel' ? [e.id] : []
  );
  if (channelIds.length > 0) {
    const deleted = new Set(channelIds);
    // A deletion settling after another sign-in leaves that sign-in's
    // channel reads alone: it reads everything again itself.
    if (!writer || isCurrentQueryAccount(writer))
      queryClient.invalidateQueries({
        queryKey: channelKeys._def,
        // The deleted channels' own reads. The directory refresh below reads
        // the directory again itself, and Quick Access rereads its cached
        // channels when the cache drops them: both are account-wide reads one
        // deletion should not repeat.
        predicate: ({ queryKey }) =>
          typeof queryKey[2] === 'string' && deleted.has(queryKey[2]),
      });
    // The channel directory rereads its pages, or waits for the soup update:
    // the deleted channels come out at once, with no read of each.
    fireAndForget(
      refreshChannelDirectory([], { removed: channelIds, writer }),
      'channel-delete'
    );
  }
  if (entities.some((e) => e.type === 'call')) {
    queryClient.invalidateQueries({ queryKey: callKeys._def });
  }
  if (entities.some((e) => e.type === 'routine')) {
    const deletedIds = new Set(
      entities.filter((e) => e.type === 'routine').map((e) => e.id)
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
    // A sub-routine is listed under its parent, and goes with it.
    queryClient.setQueryData(
      scheduledActionKeys.subRoutines.queryKey,
      (current: unknown) => {
        if (!Array.isArray(current)) return current;
        return current.filter(
          (item: { id?: string; sub_routine?: { parent_id?: string } }) =>
            !(item.id && deletedIds.has(item.id)) &&
            !(
              item.sub_routine?.parent_id &&
              deletedIds.has(item.sub_routine.parent_id)
            )
        );
      }
    );
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.list.queryKey,
    });
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.subRoutines.queryKey,
    });
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.children._def,
    });
    for (const scheduleId of deletedIds) {
      queryClient.removeQueries({
        queryKey: scheduledActionKeys.detail({ scheduleId }).queryKey,
      });
      queryClient.removeQueries({
        queryKey: scheduledActionKeys.history({ scheduleId }).queryKey,
      });
    }
  }
}

async function settleDssDeletes(
  entities: EntityData[],
  deletions: Promise<boolean>[],
  writer: QueryAccount | undefined,
  acknowledgements: Map<string, Promise<boolean>>
) {
  const outcomes = await Promise.allSettled(deletions);
  const results = outcomes.map(
    (outcome) => outcome.status === 'fulfilled' && outcome.value
  );
  // Process confirmed successes before surfacing sibling failures. Never remove
  // failed schedules or skip call invalidation because another API threw.
  try {
    invalidateDeletedDssItems(
      entities.filter((_, index) => results[index]),
      writer
    );
  } catch (error) {
    console.error('Failed to reconcile deleted item caches', error);
  }
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (results.some((success) => !success)) {
    if (failure && !results.some(Boolean)) throw failure.reason;
    throw new BulkDeleteFailure(
      entities,
      results,
      failure?.reason,
      acknowledgements
    );
  }
  return { results, acknowledgements };
}

function isHistoryList(body: object): boolean {
  const params = 'params' in body ? body.params : undefined;
  if (typeof params !== 'object' || params === null) return false;
  const sort = 'sort_method' in params ? params.sort_method : undefined;
  return (
    sort === undefined || sort === 'viewed_at' || sort === 'viewed_updated'
  );
}

function excludesAllAgentSessions(filter: unknown): boolean {
  if (typeof filter !== 'object' || filter === null) return false;
  if ('&' in filter && Array.isArray(filter['&']))
    return filter['&'].some(excludesAllAgentSessions);
  const literal = 'l' in filter ? filter.l : undefined;
  return (
    typeof literal === 'object' &&
    literal !== null &&
    'id' in literal &&
    literal.id === NIL_UUID
  );
}

function removeDssEntityCaches(entities: EntityData[]) {
  const ids = new Set(entities.map((entity) => entity.id));
  const keys = new Set(
    entities.flatMap((entity) => {
      const key = soupEntityKey(entity);
      return key ? [key] : [];
    })
  );
  return {
    keys,
    soupSnapshot: removeSoupEntities(ids, (item, id) =>
      keys.has(soupEntityKey({ type: item.tag, id }) ?? '')
    ),
    searchSnapshot: removeSearchEntities(ids, (item, id) =>
      keys.has(soupEntityKey({ type: item.type, id }) ?? '')
    ),
  };
}

export function createBulkDeleteDssItemsMutation() {
  const isDeletable = (entity: EntityData) => {
    const type = entity.type;
    return (
      type === 'agent_session' ||
      type === 'channel' ||
      type === 'chat' ||
      type === 'document' ||
      type === 'project' ||
      type === 'call' ||
      type === 'routine' ||
      type === 'database'
    );
  };
  const isCurrentContext = (context: { accountSession: number }) =>
    context.accountSession === queryAccountSession() &&
    queryClient
      .getMutationCache()
      .getAll()
      .some((mutation) => mutation.state.context === context);
  // TanStack passes the same function context to onMutate and mutationFn.
  const overlays = new WeakMap<
    MutationFunctionContext,
    ReturnType<typeof createGraphqlSoupDeletion>
  >();
  return useMutation(() => ({
    mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
    gcTime: GRAPHQL_SOUP_DELETE_RETENTION_MS,
    meta: { accountSession: queryAccountSession() },
    mutationFn: async (entities: EntityData[], context) => {
      if (context.meta?.accountSession !== queryAccountSession())
        throw new QueryAccountChangedError();
      // The sign-in that deletes: a deletion settling after another sign-in
      // holds nothing in its directory.
      const writer = currentQueryAccount();
      const deletable = entities.filter(isDeletable);
      const acknowledgements = new Map<string, Promise<boolean>>();
      const overlay = overlays.get(context);
      const deletions = deletable.map(async (e) => {
        const key = soupEntityKey(e);
        const acknowledge: OnSoupDeletion | undefined = key
          ? {
              onDispatched: (at) => overlay?.markDispatched(key, at),
              onAcknowledged: (ready) => acknowledgements.set(key, ready),
            }
          : undefined;
        if (e.type === 'agent_session') {
          await deleteAgentSession(e.id);
          return true;
        }
        if (e.type === 'channel') {
          await permanentlyDeleteEntity(
            { type: 'CHANNEL', id: e.id },
            acknowledge
          );
          return true;
        }
        if (e.type === 'call') {
          await permanentlyDeleteEntity(
            { type: 'CALL', id: e.id },
            acknowledge
          );
          return true;
        }
        if (e.type === 'routine') {
          return throwOnErr(() =>
            scheduledActionClient.deleteSchedule({ scheduleId: e.id })
          ).then(() => true);
        }
        if (e.type === 'database') {
          await throwOnErr(() =>
            trashDatabase(getEntityGraphqlClient(), e.id).mapErr((failure) => [
              {
                code: failure.kind,
                message: databaseEntityMessage(failure, 'delete'),
              },
            ])
          );
          return true;
        }
        return deleteItem({ id: e.id, itemType: e.type }, acknowledge);
      });
      return settleDssDeletes(deletable, deletions, writer, acknowledgements);
    },
    onMutate: async (entities: EntityData[], context) => {
      if (context.meta?.accountSession !== queryAccountSession())
        throw new QueryAccountChangedError();
      const deletable = entities.filter(isDeletable);
      const { keys, ...snapshots } = removeDssEntityCaches(deletable);
      const graphqlDeletion = createGraphqlSoupDeletion([...keys]);
      overlays.set(context, graphqlDeletion);
      return {
        ...snapshots,
        accountSession: queryAccountSession(),
        graphqlDeletion,
      };
    },
    onSettled: (outcome, error, entities, context) => {
      if (!context) return;
      const { graphqlDeletion: deletion, accountSession } = context;
      // Logout/cache clearing can outlive an in-flight API call. Do not
      // repopulate session-local tombstones after their mutation was cleared.
      if (!isCurrentContext(context)) {
        deletion.release();
        return;
      }
      const result = error instanceof BulkDeleteFailure ? error : outcome;
      const deletedKeys = entities
        .filter(isDeletable)
        .flatMap((entity, index) => {
          const key = soupEntityKey(entity);
          return result?.results[index] === true && key ? [key] : [];
        });
      const acknowledgements = new Map(result?.acknowledgements);
      const legacyKeys = deletedKeys.filter(
        (key) => !acknowledgements.has(key)
      );
      const historyOnlyKeys = new Set(
        legacyKeys.filter((key) => !key.startsWith('GraphqlSoupAgentSession:'))
      );
      if (legacyKeys.length > 0) {
        // History removals and agent-session deletes have no GraphQL result
        // for the exchange to apply or revalidate. Share one read for them.
        const hasAgentSessionDeletes = legacyKeys.length > historyOnlyKeys.size;
        const ready = recoverActiveGraphqlSoupQueries({
          isPending: () =>
            accountSession === queryAccountSession() &&
            legacyKeys.some((key) => deletion.keys().includes(key)),
          where: (body) =>
            typeof body === 'object' &&
            body !== null &&
            ((hasAgentSessionDeletes &&
              'asf' in body &&
              !!body.asf &&
              !excludesAllAgentSessions(body.asf)) ||
              (historyOnlyKeys.size > 0 && isHistoryList(body))),
        });
        for (const key of legacyKeys) acknowledgements.set(key, ready);
      }
      deletion.settle(deletedKeys, acknowledgements, historyOnlyKeys);
    },
    onError: (error, entities, context) => {
      if (context && !isCurrentContext(context)) {
        context.graphqlDeletion.release();
        return;
      }
      if (error instanceof QueryAccountChangedError) return;
      const partialFailure =
        error instanceof BulkDeleteFailure && error.deletedEntities.length > 0;
      if (partialFailure) {
        // The legacy transactions hold whole snapshots. Restore failed rows,
        // then reapply confirmed removals in one reactive batch so successes
        // never reappear in REST fallback lists or search results.
        batch(() => {
          context?.soupSnapshot.rollback();
          context?.searchSnapshot.rollback();
          removeDssEntityCaches(error.deletedEntities);
        });
      } else {
        context?.soupSnapshot.rollback();
        context?.searchSnapshot.rollback();
      }
      console.error(`Failed to delete dss items`, entities, error);
      toast.failure(partialFailure ? error.message : 'Failed to delete items');
    },
  }));
}

type FolderMovableType =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'database'
  | 'form';

const isFolderMovable = (
  entity: EntityData
): entity is EntityData & { type: FolderMovableType } =>
  entity.type === 'document' ||
  entity.type === 'chat' ||
  entity.type === 'project' ||
  entity.type === 'email' ||
  entity.type === 'database' ||
  entity.type === 'form';

/**
 * Databases and forms reach Drive through their own lists, not Soup: refile
 * them there at once, answering how to put them back.
 */
function refileListedEntities(
  entities: readonly EntityData[],
  projectId: string | null
) {
  const databaseIds = new Set(
    entities.flatMap((e) => (e.type === 'database' ? [e.id] : []))
  );
  const formIds = new Set(
    entities.flatMap((e) => (e.type === 'form' ? [e.id] : []))
  );
  const databases = queryClient.getQueryData<ListedDatabase[]>(
    databasesKeys.list.queryKey
  );
  const forms = queryClient.getQueryData<ListedForm[]>(formsKeys.list.queryKey);
  if (databases && databaseIds.size > 0) {
    queryClient.setQueryData<ListedDatabase[]>(
      databasesKeys.list.queryKey,
      databases.map((listed) =>
        databaseIds.has(listed.database.id)
          ? {
              ...listed,
              database: { ...listed.database, project_id: projectId },
            }
          : listed
      )
    );
  }
  if (forms && formIds.size > 0) {
    queryClient.setQueryData<ListedForm[]>(
      formsKeys.list.queryKey,
      forms.map((listed) =>
        formIds.has(listed.form.id)
          ? { ...listed, form: { ...listed.form, projectId } }
          : listed
      )
    );
  }
  return {
    rollback: () => {
      if (databases && databaseIds.size > 0)
        queryClient.setQueryData(databasesKeys.list.queryKey, databases);
      if (forms && formIds.size > 0)
        queryClient.setQueryData(formsKeys.list.queryKey, forms);
    },
  };
}

/** Re-read the database and form lists after their entities moved. */
function invalidateListedEntities(entities: readonly EntityData[]) {
  if (entities.some((e) => e.type === 'database'))
    fireAndForget(
      queryClient.invalidateQueries({ queryKey: databasesKeys.list.queryKey }),
      'entity-move'
    );
  if (entities.some((e) => e.type === 'form'))
    fireAndForget(
      queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey }),
      'entity-move'
    );
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
  return refreshActiveGraphqlSoupQueries();
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

      return invalidateAfterMove([id], project.id, type === 'project', failed);
    },
  }));
}

export function createBulkRemoveFromProjectDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({ entities }: { entities: EntityData[] }) => {
      if (!entities.every(isFolderMovable)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((entity) =>
          moveToFolder({
            itemType: entity.type,
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
          // A move is an Edited activity, i.e. a touch (own-touch.ts).
          touched_at: ownTouchStamp(e.id),
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
        ),
        refileListedEntities(entities, null)
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
      invalidateListedEntities(entities);

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
      return refreshActiveGraphqlSoupQueries();
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
  const isUnsupportedEntity = (entity: EntityData) =>
    (entity.type !== 'chat' &&
      entity.type !== 'document' &&
      entity.type !== 'project' &&
      entity.type !== 'database') ||
    !canDuplicateItemType(entity.type);

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
            itemType: e.type,
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
      await queryClient.cancelQueries({
        queryKey: soupKeys.items._def,
      });
      await queryClient.cancelQueries({
        queryKey: soupKeys.astItems._def,
      });
    },

    onSettled: (data, error, { entities }) => {
      if (error) {
        // The copy action shows the failure, with the folder-size hint.
        console.error(`Failed bulk copy`, entities, data, error);
      }

      // Trigger refetch so new items appear
      queryClient.invalidateQueries({
        queryKey: soupKeys.items._def,
      });
      queryClient.invalidateQueries({
        queryKey: soupKeys.astItems._def,
      });
      queryClient.invalidateQueries({ queryKey: ['entity'] });
      return refreshActiveGraphqlSoupQueries();
    },
  }));
}

export function createBulkMoveToProjectDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      entities,
      project,
      parentSpan,
    }: {
      entities: (EntityData & { name: string })[];
      project: { id: string; name: string };
      parentSpan?: TraceContext;
    }) => {
      if (!entities.every(isFolderMovable)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((entity) =>
          (parentSpan ?? Telemetry.captureContext()).run(() =>
            moveToFolder({
              itemType: entity.type,
              id: entity.id,
              folderId: project.id,
            })
          )
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
      parentSpan?: TraceContext;
    }) => {
      const moveableEntities = entities.filter(
        (e): e is typeof e & { type: 'document' | 'chat' | 'email' } =>
          e.type === 'document' || e.type === 'chat' || e.type === 'email'
      );
      return [
        ...moveableEntities.map((e) => {
          const current = getSoupEntityById(e.id);
          const tag = e.type === 'email' ? 'emailThread' : e.type;
          return optimisticUpdateSoupEntity({
            tag,
            data: { id: e.id, projectId: project.id },
            frecency_score: current?.frecency_score ?? 0,
            // A move is an Edited activity, i.e. a touch (own-touch.ts).
            touched_at: ownTouchStamp(e.id),
          });
        }),
        refileListedEntities(entities, project.id),
      ];
    },

    onSettled: (data, error, { entities, project, parentSpan }, context) => {
      const failed = data?.success === false || !!error;
      if (failed) {
        context?.forEach((txn) => txn.rollback());
        console.error(`Failed to bulk move dss items`, entities, data, error);
      }
      invalidateListedEntities(entities);

      return (parentSpan ?? Telemetry.captureContext()).run(() =>
        invalidateAfterMove(
          entities.map((e) => e.id),
          project.id,
          entities.some((e) => e.type === 'project'),
          failed
        )
      );
    },
  }));
}
