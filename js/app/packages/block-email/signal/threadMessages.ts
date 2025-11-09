import { createBlockResource } from '@core/block';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { isErr } from '@core/util/maybeResult';
import { logger } from '@observability/logger';
import { emailClient } from '@service-email/client';
import type { Thread } from '@service-email/generated/schemas/thread';
import { reconcile } from 'solid-js/store';

export type ThreadMessagesFetchResult = {
  thread: Thread;
  hasMore: boolean;
};

const fetchThreadMessages = async (
  threadId: string,
  {
    value,
    refetching,
  }: {
    value?: ThreadMessagesFetchResult;
    refetching?: boolean | { offset?: number };
  }
): Promise<ThreadMessagesFetchResult> => {
  const offset =
    refetching && typeof refetching === 'object' && refetching.offset
      ? refetching.offset
      : 0;

  const result = await emailClient.getThread({
    thread_id: threadId,
    offset,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  });

  if (isErr(result)) {
    logger.error(`Failed to get email thread messages: ${result[0]}`);
    throw new Error(`Failed to get email thread messages: ${result[0]}`);
  }

  const [, data] = result;
  const newMessages = data.thread.messages ?? [];

  const existingMessages = offset > 0 && value ? value.thread.messages : [];
  const allMessages = [...existingMessages, ...newMessages];

  const hasMore = newMessages.length === DEFAULT_THREAD_MESSAGES_LIMIT;

  return {
    thread: {
      ...data.thread,
      messages: allMessages,
    },
    hasMore,
  };
};

export const createThreadMessagesResource = (
  threadId: string,
  initialThread?: Thread
) => {
  // Create initial data from the thread if provided
  const initialData: ThreadMessagesFetchResult | undefined = initialThread
    ? {
        thread: initialThread,
        hasMore: initialThread.messages.length >= DEFAULT_THREAD_MESSAGES_LIMIT,
      }
    : undefined;

  const [resource, { mutate, refetch }] = createBlockResource(
    () => threadId,
    fetchThreadMessages,
    { initialValue: initialData }
  );

  const loadMore = () => {
    const currentData = resource();
    if (currentData && currentData.hasMore && !resource.loading) {
      const nextOffset = currentData.thread.messages.length;
      refetch({ offset: nextOffset });
    }
  };

  const refresh = async () => {
    const freshResult = await emailClient.getThread({
      thread_id: threadId,
      offset: 0,
      limit: DEFAULT_THREAD_MESSAGES_LIMIT,
    });
    if (isErr(freshResult)) {
      logger.error(
        `Failed to refresh email thread messages: ${freshResult[0]}`
      );
      return;
    }
    const [, freshData] = freshResult;
    const currentData = resource();
    if (!currentData) {
      refetch({ offset: 0 });
      return;
    }

    // We need to manually reconcile messages in the thread, to maintain
    // referential stability across updates. Without this solid will treat all the messages as new,
    // re-render all of them, which will cause a flicker. With this only the new messages will be added.
    mutate((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        thread: {
          ...freshData.thread,
          messages: reconcile(freshData.thread.messages, {
            key: 'db_id',
            merge: false, // Don't merge partial updates, replace entirely
          })(prev.thread.messages),
        },
        hasMore:
          freshData.thread.messages.length >= DEFAULT_THREAD_MESSAGES_LIMIT,
      };
    });
  };

  return {
    resource,
    mutate,
    loadMore,
    refresh,
    loading: () => resource.loading,
  };
};
