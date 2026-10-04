import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { createQueryAuthorization } from '@queries/authorization';
import { createLivePreviewBatcher } from '@queries/preview/live-batcher';
import { TaskInitiativeReferencesDocument } from '@service-storage/graphql/generated/graphql';
import {
  type QueryClient,
  useIsMutating,
  useMutationState,
} from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  mapArray,
  onCleanup,
} from 'solid-js';
import type { ProjectDetail, TaskProjectReference } from '../core/project';
import type {
  ProjectTaskMutationContext,
  ProjectTaskMutationData,
  ProjectTaskMutationVariables,
} from './create-project-task';
import { projectKeys } from './keys';
import { registerProjectRevalidation } from './project-revalidation';

function startBatch(client: Client, cache: QueryClient, taskIds: string[]) {
  return createRoot((dispose) => {
    const creating = useIsMutating(
      () => ({ mutationKey: projectKeys.createTask._def }),
      () => cache
    );
    const authorization = createQueryAuthorization(() => 'batch');
    const query = createLiveQuery(
      TaskInitiativeReferencesDocument,
      () => ({ taskIds }),
      () => ({
        client,
        requestPolicy: creating() ? 'cache-only' : 'cache-and-network',
        keepPreviousData: false,
        onResult: authorization.onResult,
      })
    );
    registerProjectRevalidation(
      () => client,
      () => !creating(),
      () => query.refetch({ requestPolicy: 'cache-and-network' })
    );
    return { value: { query, denied: authorization.error }, dispose };
  });
}
type Batch = ReturnType<typeof startBatch>['value'];
const batchers = new WeakMap<
  Client,
  WeakMap<
    QueryClient,
    Map<string, ReturnType<typeof createLivePreviewBatcher<string, Batch>>>
  >
>();
function batcher(client: Client, cache: QueryClient, userId: string) {
  let caches = batchers.get(client);
  if (!caches) {
    caches = new WeakMap();
    batchers.set(client, caches);
  }
  let viewers = caches.get(cache);
  if (!viewers) {
    viewers = new Map();
    caches.set(cache, viewers);
  }
  let value = viewers.get(userId);
  if (!value) {
    value = createLivePreviewBatcher<string, Batch>({
      maxSize: 100,
      start: (ids) => startBatch(client, cache, ids),
    });
    viewers.set(userId, value);
  }
  return value;
}

/** Stable batches preserve existing chips when sibling task IDs enter or leave. */
export function createProjectReferences(
  client: () => Client,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  ids: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  const creations = useMutationState(
    () => ({
      filters: { mutationKey: projectKeys.createTask._def },
      select: (mutation) => ({
        status: mutation.state.status,
        variables: mutation.state.variables as
          | ProjectTaskMutationVariables
          | undefined,
        data: mutation.state.data as ProjectTaskMutationData | undefined,
        context: mutation.state.context as
          | ProjectTaskMutationContext
          | undefined,
      }),
    }),
    () => cache
  );
  const keys = createMemo(() =>
    !enabled() || !userId()
      ? []
      : [...new Set(ids())].map((id) => JSON.stringify([userId(), id]))
  );
  const entries = mapArray(keys, (key) => {
    const [viewer, id]: [string, string] = JSON.parse(key);
    const [group, setGroup] = createSignal<Batch>();
    createComputed(() => {
      setGroup(undefined);
      const subscription = batcher(client(), cache, viewer).acquire(
        id,
        id,
        setGroup
      );
      onCleanup(subscription.dispose);
    });
    return { id, group };
  });
  const references = createMemo(() => {
    const result = new Map<string, TaskProjectReference>();
    for (const { id, group } of entries()) {
      const batch = group();
      if (batch?.denied()) {
        result.set(id, { state: 'unavailable' });
        continue;
      }
      if (batch?.query.data && batch.query.data.user.id !== userId()) continue;
      const reference = batch?.query.data?.user.taskInitiativeReferences.find(
        (reference) => reference.taskId === id
      );
      if (reference) {
        result.set(
          id,
          reference.state === 'VISIBLE' && reference.initiative
            ? {
                state: 'visible',
                id: reference.initiative.id,
                name: reference.initiative.displayName ?? 'Untitled project',
              }
            : { state: reference.state === 'NONE' ? 'none' : 'unavailable' }
        );
        continue;
      }
      // Only our own pending/just-created tasks may supply local membership.
      // Never infer it for an existing task or replace an authorized answer.
      if (
        batch?.query.error ||
        (batch?.query.isFetched && !batch.query.isFetching && batch.query.data)
      )
        continue;
      const creation = creations().find(
        ({ status, variables, data, context }) =>
          variables !== undefined &&
          variables.ownerId === userId() &&
          (!variables.scope || variables.scope.isCurrent()) &&
          ((status === 'pending' &&
            (context ? context.membershipId() === id : variables.id === id)) ||
            (data?.assigned && data.result.documentId === id))
      );
      if (!creation?.variables) continue;
      const detail = cache.getQueryData<{ project: ProjectDetail }>(
        projectKeys.detail(userId(), creation.variables.projectId).queryKey
      );
      if (detail)
        result.set(id, {
          state: 'visible',
          id: detail.project.id,
          name: detail.project.name,
        });
    }
    return result;
  });
  return {
    references,
    loading: () =>
      entries().some(({ group }) => !group() || group()!.query.isPending),
    error: () =>
      entries()
        .map(({ group }) => group()?.denied() ?? group()?.query.error)
        .find(Boolean) ?? undefined,
  };
}
