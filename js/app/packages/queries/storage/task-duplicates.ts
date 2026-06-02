import { queryClient } from '@queries/client';
import {
  storageServiceClient,
  type TaskDuplicate,
  type TaskSimilarityResult,
} from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys, taskSimilaritySearchKeys } from './keys';

type TaskDuplicateMatchesUpdatedPayload = {
  documentId: string;
};

export function invalidateTaskDuplicates(documentId: string) {
  return queryClient.invalidateQueries({
    queryKey: entityKeys.taskDuplicates(documentId).queryKey,
  });
}

export function handleTaskDuplicateMatchesUpdated(
  payload: TaskDuplicateMatchesUpdatedPayload
) {
  if (typeof payload.documentId !== 'string') {
    console.warn('Malformed task duplicate live update payload', payload);
    return;
  }
  invalidateTaskDuplicates(payload.documentId);
}

async function fetchTaskDuplicates(
  documentId: string
): Promise<TaskDuplicate[]> {
  const result = await storageServiceClient.getTaskDuplicates({ documentId });
  if (result.isErr()) {
    throw new Error('Failed to fetch task duplicates');
  }
  return result.value;
}

export function useTaskDuplicatesQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: entityKeys.taskDuplicates(documentId()).queryKey,
    queryFn: () => fetchTaskDuplicates(documentId()),
    enabled: !!documentId(),
    staleTime: 30 * 1000,
  }));
}

export function useDismissTaskDuplicatesMutation(documentId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: async (params: {
      matchIds: string[];
      otherDocumentIds?: string[];
    }) => {
      const result = await storageServiceClient.dismissTaskDuplicates({
        documentId: documentId(),
        matchIds: params.matchIds,
      });
      if (result.isErr()) throw new Error('Failed to dismiss duplicate');
    },
    onSuccess: (_data, params) => {
      invalidateTaskDuplicates(documentId());
      for (const otherDocumentId of params.otherDocumentIds ?? []) {
        invalidateTaskDuplicates(otherDocumentId);
      }
    },
  }));
}

/** Minimum title length before the live similarity search fires. */
export const SIMILARITY_SEARCH_MIN_TITLE_LENGTH = 3;

type TaskSimilaritySearchInput = {
  title: string;
  markdown: string;
  shareWithTeam: boolean;
};

async function searchSimilarTasks(
  input: TaskSimilaritySearchInput
): Promise<TaskSimilarityResult[]> {
  const result = await storageServiceClient.searchSimilarTasks({
    taskName: input.title,
    markdown: input.markdown,
    shareWithTeam: input.shareWithTeam,
  });
  if (result.isErr()) {
    throw new Error('Failed to search for similar tasks');
  }
  return result.value;
}

/**
 * Live, ephemeral similarity search used by the task composer. Hits the
 * stateless `/documents/similarity_search` HTTP endpoint — nothing is
 * persisted, so there is no cache invalidation or dismiss flow.
 *
 * `initialData` lets a restored composer draft seed the results for its
 * initial input so saved matches render instantly without a refetch flash.
 */
export function useTaskSimilaritySearchQuery(
  input: Accessor<TaskSimilaritySearchInput>,
  initialData?: Accessor<TaskSimilarityResult[] | undefined>
) {
  return useQuery(() => ({
    queryKey: taskSimilaritySearchKeys.forInput(input()).queryKey,
    queryFn: () => searchSimilarTasks(input()),
    enabled: input().title.trim().length >= SIMILARITY_SEARCH_MIN_TITLE_LENGTH,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
    initialData: initialData?.(),
  }));
}

export function useDeleteThisDuplicateTaskMutation(
  documentId: Accessor<string>
) {
  return useMutation(() => ({
    mutationFn: async (matchId: string) => {
      const result = await storageServiceClient.deleteThisDuplicateTask({
        documentId: documentId(),
        matchId,
      });
      if (result.isErr()) throw new Error('Failed to delete task');
    },
  }));
}
