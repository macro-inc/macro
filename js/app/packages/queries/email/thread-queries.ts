import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { emailKeys } from './keys';
import { emailClient } from '@service-email/client';
import { isErr, isOk } from '@core/util/maybeResult';
import type {
  GetThreadResponse,
  MessageToSend,
  SendMessageResponse,
  Thread,
} from '@service-email/generated/schemas';
import { type MutationCallbacks, withCallbacks } from '../utils';

/**
 * Shared infinite query options for thread fetching.
 */
function threadQueryOptions(threadId: string) {
  return {
    queryKey: emailKeys.threadMessages(threadId).queryKey,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const result = await emailClient.getThread({
        thread_id: threadId,
        offset: pageParam,
        limit: DEFAULT_THREAD_MESSAGES_LIMIT,
      });

      if (isErr(result)) {
        throw new Error('Failed to fetch thread');
      }

      const threadData = result[1];

      return threadData.thread;
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
): Promise<GetThreadResponse | undefined> {
  const staleTime = options?.staleTime ?? 5 * 60 * 1000;

  try {
    if (options?.forceRefresh) {
      await queryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(threadId).queryKey,
      });
    }

    const data = await queryClient.fetchInfiniteQuery({
      ...threadQueryOptions(threadId),
      staleTime,
    });

    const thread = flattenThreadPages(data);
    return thread ? { thread } : undefined;
  } catch {
    return undefined;
  }
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
