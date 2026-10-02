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
  const empty = () =>
    query.isLoadingError && thrownResultErrorHasCode(query.error, 'NOT_FOUND');
  const unavailable = () =>
    query.isError &&
    ['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'].some((code) =>
      thrownResultErrorHasCode(query.error, code)
    );
  return {
    parent,
    thread: () =>
      query.isSuccess || (query.isRefetchError && !unavailable())
        ? query.data
        : undefined,
    empty,
    loading: () => query.isPending,
    failed: () => query.isError && !empty(),
    refresh: () => query.refetch(),
  };
}
