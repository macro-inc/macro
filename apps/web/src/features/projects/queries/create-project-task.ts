import { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import type { initiativeClient } from '@service-storage/initiative';
import { type QueryClient, useMutation } from '@tanstack/solid-query';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { projectKeys } from './keys';
import {
  captureProjectCacheScope,
  type ProjectCacheScope,
} from './project-cache-scope';
import {
  optimisticProjectTask,
  type ProjectTaskDraft,
  updateProjectTaskCache,
} from './project-task-cache';

export type ProjectTaskMutationVariables = {
  projectId: string;
  draft: ProjectTaskDraft;
  id: string;
  ownerId: string;
  scope: ProjectCacheScope;
};
export type ProjectTaskMutationData = {
  result: NonNullable<Awaited<ReturnType<typeof createTaskWithProperties>>>;
  assigned: boolean;
};
export type ProjectTaskMutationContext = {
  task: ReturnType<typeof optimisticProjectTask>;
  membershipId: Accessor<string | undefined>;
  setMembershipId: Setter<string | undefined>;
};

/** Owns task creation and membership as one optimistic mutation. */
export function createProjectTaskMutation(
  client: Pick<typeof initiativeClient, 'assignTasks'>,
  cacheHost: () => CacheHost | undefined,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  refresh: () => Promise<void>
) {
  // Cache read/write pairs must stay ordered when Create More submits overlap.
  let writes = Promise.resolve();
  const update = (...args: Parameters<typeof updateProjectTaskCache>) => {
    const next = writes.then(() => updateProjectTaskCache(...args));
    writes = next.catch(() => {});
    return next;
  };
  const pendingTaskIds = (input: ProjectTaskMutationVariables) =>
    cache
      .getMutationCache()
      .findAll({
        mutationKey: projectKeys.createTask._def,
        status: 'pending',
      })
      .flatMap((mutation) => {
        const variables = mutation.state.variables as
          | ProjectTaskMutationVariables
          | undefined;
        const context = mutation.state.context as
          | ProjectTaskMutationContext
          | undefined;
        const id = context?.membershipId();
        return id &&
          variables?.ownerId === input.ownerId &&
          variables.projectId === input.projectId &&
          variables.scope?.isCurrent()
          ? [id]
          : [];
      });
  const mutation = useMutation(
    () => ({
      mutationKey: projectKeys.createTask._def,
      onMutate: async (input: ProjectTaskMutationVariables) => {
        const task = optimisticProjectTask(
          input.id,
          input.ownerId,
          input.draft
        );
        const [membershipId, setMembershipId] = createSignal<
          string | undefined
        >(input.id);
        try {
          await update(
            cache,
            input.scope.host,
            input.ownerId,
            input.projectId,
            undefined,
            task,
            {
              isCurrent: input.scope.isCurrent,
              pendingTaskIds: () => pendingTaskIds(input),
            }
          );
        } finally {
          if (input.scope.isCurrent()) input.draft[5]?.onMutate?.();
        }
        return { task, membershipId, setMembershipId };
      },
      mutationFn: async ({
        projectId,
        draft,
        scope,
      }: ProjectTaskMutationVariables) => {
        if (!scope.isCurrent())
          throw new Error('Task creation session changed');
        const [title, content, properties, definitions, history] = draft;
        const result = await createTaskWithProperties(
          title,
          content,
          properties,
          definitions,
          history,
          { revalidateSoup: false, shareWithTeam: draft[5]?.shareWithTeam }
        );
        if (!result) throw new Error('Task creation failed');
        if (!scope.isCurrent()) return { result, assigned: false };
        let assigned = false;
        try {
          const response = await throwOnErr(() =>
            client.assignTasks(projectId, { taskIds: [result.documentId] })
          );
          assigned = response.results.every(
            (item) => item.status === 'assigned'
          );
        } catch {
          /* Preserve the saved task if only project assignment failed. */
        }
        if (!assigned && scope.isCurrent())
          toast.failure(
            'Task created, but could not be added to the project. Use Set project from the task menu to try again.'
          );
        return { result, assigned };
      },
      onSuccess: async ({ result, assigned }, input, context) => {
        await update(
          cache,
          input.scope.host,
          input.ownerId,
          input.projectId,
          input.id,
          assigned && context
            ? { ...context.task, id: result.documentId }
            : undefined,
          {
            isCurrent: input.scope.isCurrent,
            pendingTaskIds: () => pendingTaskIds(input),
            onReady: () =>
              context?.setMembershipId(
                assigned ? result.documentId : undefined
              ),
          }
        );
      },
      onError: async (_error, input, context) => {
        await update(
          cache,
          input.scope.host,
          input.ownerId,
          input.projectId,
          input.id,
          undefined,
          {
            isCurrent: input.scope.isCurrent,
            pendingTaskIds: () => pendingTaskIds(input),
            onReady: () => context?.setMembershipId(undefined),
          }
        );
      },
    }),
    () => cache
  );
  return async (projectId: string, ...draft: ProjectTaskDraft) => {
    const ownerId = userId();
    if (!ownerId) return null;
    const scope = captureProjectCacheScope(userId, cacheHost);
    try {
      const data = await mutation.mutateAsync({
        projectId,
        draft,
        ownerId,
        id: crypto.randomUUID(),
        scope,
      });
      return scope.isCurrent() ? data.result : null;
    } catch {
      return null;
    } finally {
      if (
        scope.isCurrent() &&
        !cache.isMutating({ mutationKey: projectKeys.createTask._def })
      )
        void refresh();
      scope.dispose();
    }
  };
}
