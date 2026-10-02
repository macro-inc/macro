import { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import type { initiativeClient } from '@service-storage/initiative';
import { type QueryClient, useMutation } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { projectKeys } from './keys';
import {
  optimisticProjectTask,
  type ProjectTaskDraft,
  updateProjectTaskCache,
} from './project-task-cache';

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
  const mutation = useMutation(
    () => ({
      mutationKey: projectKeys.createTask._def,
      onMutate: async (input: {
        projectId: string;
        draft: ProjectTaskDraft;
        id: string;
        ownerId: string;
      }) => {
        const task = optimisticProjectTask(
          input.id,
          input.ownerId,
          input.draft
        );
        try {
          await update(
            cache,
            cacheHost(),
            input.ownerId,
            input.projectId,
            undefined,
            task
          );
        } finally {
          input.draft[5]?.onMutate?.();
        }
        return { task };
      },
      mutationFn: async ({
        projectId,
        draft,
      }: {
        projectId: string;
        draft: ProjectTaskDraft;
        id: string;
        ownerId: string;
      }) => {
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
        if (!assigned)
          toast.failure(
            'Task created, but could not be added to the project. Use Add to project from the task menu to try again.'
          );
        return { result, assigned };
      },
      onSuccess: async ({ result, assigned }, input, context) => {
        await update(
          cache,
          cacheHost(),
          input.ownerId,
          input.projectId,
          input.id,
          assigned && context
            ? { ...context.task, id: result.documentId }
            : undefined
        );
      },
      onError: async (_error, input) => {
        await update(
          cache,
          cacheHost(),
          input.ownerId,
          input.projectId,
          input.id
        );
      },
    }),
    () => cache
  );
  return async (projectId: string, ...draft: ProjectTaskDraft) => {
    const ownerId = userId();
    if (!ownerId) return null;
    try {
      return (
        await mutation.mutateAsync({
          projectId,
          draft,
          ownerId,
          id: crypto.randomUUID(),
        })
      ).result;
    } catch {
      return null;
    } finally {
      if (!cache.isMutating({ mutationKey: projectKeys.createTask._def }))
        void refresh();
    }
  };
}
