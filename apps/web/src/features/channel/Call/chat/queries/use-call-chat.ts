import { thrownResultErrorHasCode } from '@core/util/result';
import { useMessageSubscription } from '@queries/messages/subscription';
import { threadRepliesQueryOptions } from '@queries/messages/thread-replies';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { callChatKeys } from './keys';

/** A missing canonical root means nobody has sent the first message yet. */
export function useCallChat(callId: Accessor<string>) {
  const parent = () => ({ type: 'call' as const, id: callId() });
  useMessageSubscription(parent);
  const query = useQuery(() => ({
    ...threadRepliesQueryOptions(parent(), callId()),
    queryKey: callChatKeys.threadReplies(parent(), callId()).queryKey,
    retry: false,
    refetchOnMount: 'always' as const,
  }));
  return {
    parent,
    thread: () =>
      query.isSuccess || query.isRefetchError ? query.data : undefined,
    empty: () =>
      query.isError && thrownResultErrorHasCode(query.error, 'NOT_FOUND'),
    loading: () => query.isPending,
    failed: () =>
      query.isError && !thrownResultErrorHasCode(query.error, 'NOT_FOUND'),
    refresh: () => query.refetch(),
  };
}
