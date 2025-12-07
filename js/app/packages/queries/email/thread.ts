import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { catchToResult, isErr, ok, throwOnErr } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import type {
  MessageToSend,
  SendMessageResponse,
  Thread,
} from '@service-email/generated/schemas';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';

/**
 * Shared infinite query options for thread fetching.
 */
function threadQueryOptions(threadId: string) {
  return {
    queryKey: emailKeys.threadMessages(threadId).queryKey,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const result = await throwOnErr(
        async () =>
          await emailClient.getThread({
            thread_id: threadId,
            offset: pageParam,
            limit: DEFAULT_THREAD_MESSAGES_LIMIT,
          })
      );

      return result.thread;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: Thread, allPages: Thread[]) => {
      if (lastPage.messages.length < DEFAULT_THREAD_MESSAGES_LIMIT) {
        return undefined;
      }
      return allPages.reduce((sum, p) => sum + p.messages.length, 0);
    },
  };
}

/**
 * Flatten infinite query pages into a single thread with all messages.
 */
function flattenThreadPages(
  data: InfiniteData<Thread, number>
): Thread | undefined {
  if (!data?.pages[0]) return undefined;
  const firstPage = data.pages[0];
  return {
    ...firstPage,
    messages: data.pages.flatMap((p) => p.messages),
  };
}

/**
 * Imperatively fetch a thread (for use outside of components).
 * Returns cached data if fresh, otherwise fetches from server.
 */
export async function fetchAndCacheThread(
  threadId: string,
  options?: {
    forceRefresh?: boolean;
    staleTime?: number;
  }
): ReturnType<typeof emailClient.getThread> {
  const staleTime = options?.staleTime ?? 5 * 60 * 1000;

  if (options?.forceRefresh) {
    await queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(threadId).queryKey,
    });
  }

  let data: InfiniteData<Thread, number> | undefined;

  const result = await catchToResult(
    async () =>
      await queryClient.fetchInfiniteQuery({
        ...threadQueryOptions(threadId),
        staleTime,
      })
  );

  if (isErr(result)) {
    return result;
  }

  data = result[1];

  const thread = flattenThreadPages(data);
  return ok({ thread: thread! });
}

export type ThreadQueryData = {
  thread: Thread;
  hasMore: boolean;
};

/**
 * Query hook for fetching a thread with paginated messages.
 */
export function useThreadQuery(threadId: Accessor<string>) {
  return useInfiniteQuery(() => ({
    ...threadQueryOptions(threadId()),
    select: (data: InfiniteData<Thread, number>): ThreadQueryData => {
      const lastPage = data.pages.at(-1)!;
      return {
        thread: flattenThreadPages(data)!,
        hasMore: lastPage.messages.length === DEFAULT_THREAD_MESSAGES_LIMIT,
      };
    },
  }));
}

type MarkThreadAsSeenParams = { threadId: string };

/**
 * Mutation to mark a thread as seen.
 */
export function useMarkThreadAsSeenMutation(
  callbacks?: MutationCallbacks<void, Error, MarkThreadAsSeenParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: MarkThreadAsSeenParams) => {
      const result = await emailClient.markThreadAsSeen({
        thread_id: vars.threadId,
      });
      if (isErr(result)) {
        throw new Error('Failed to mark thread as seen');
      }
    },
    ...withCallbacks<void, Error, MarkThreadAsSeenParams>(
      {
        onSuccess: (_data, vars) => {
          queryClient.invalidateQueries({
            queryKey: emailKeys.threadMessages(vars.threadId).queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}

type ArchiveThreadParams = { threadId: string; archive: boolean };
type ArchiveThreadContext = {
  previousData: InfiniteData<Thread, number> | undefined;
};

/**
 * Mutation to archive or unarchive a thread.
 * Uses optimistic updates to immediately reflect the change in UI.
 */
export function useArchiveThreadMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    ArchiveThreadParams,
    ArchiveThreadContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: ArchiveThreadParams) => {
      const result = await emailClient.flagArchived({
        id: vars.threadId,
        value: vars.archive,
      });
      if (isErr(result)) {
        throw new Error('Failed to update thread archive status');
      }
    },
    ...withCallbacks<void, Error, ArchiveThreadParams, ArchiveThreadContext>(
      {
        onMutate: async (vars) => {
          await queryClient.cancelQueries({
            queryKey: emailKeys.threadMessages(vars.threadId).queryKey,
          });

          const previousData = queryClient.getQueryData<
            InfiniteData<Thread, number>
          >(emailKeys.threadMessages(vars.threadId).queryKey);

          queryClient.setQueryData<InfiniteData<Thread, number>>(
            emailKeys.threadMessages(vars.threadId).queryKey,
            (old) =>
              old && {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  inbox_visible: !vars.archive,
                })),
              }
          );

          return { previousData };
        },
        onError: (_err, vars, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(
              emailKeys.threadMessages(vars.threadId).queryKey,
              context.previousData
            );
          }
        },
        onSettled: (_data, _error, vars) => {
          queryClient.invalidateQueries({
            queryKey: emailKeys.threadMessages(vars.threadId).queryKey,
          });
          queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
        },
      },
      callbacks
    ),
  }));
}

type SendMessageParams = { message: MessageToSend };

/**
 * Mutation to send an email message.
 */
export function useSendMessageMutation(
  callbacks?: MutationCallbacks<SendMessageResponse, Error, SendMessageParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: SendMessageParams) => {
      const result = await emailClient.sendMessage({ message: vars.message });
      if (isErr(result)) {
        throw new Error('Failed to send message');
      }
      return result[1];
    },
    ...withCallbacks<SendMessageResponse, Error, SendMessageParams>(
      {
        onSuccess: (_data, vars) => {
          if (vars.message.thread_db_id) {
            queryClient.invalidateQueries({
              queryKey: emailKeys.threadMessages(vars.message.thread_db_id)
                .queryKey,
            });
          }
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
        },
      },
      callbacks
    ),
  }));
}
