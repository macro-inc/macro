import { thrownResultErrorHasCode } from '@core/util/result';
import { useMyChannelAccessRequestQuery } from '@queries/channel/access-requests';
import type { ChannelAccessRequestState } from '@service-storage/generated/schemas/channelAccessRequestState';
import type { Accessor } from 'solid-js';

type ChannelAccessRequestLoad =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; state: ChannelAccessRequestState };

/** A denied screen waits for its own read before offering request actions. */
export function useMyChannelAccessRequestState(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const query = useMyChannelAccessRequestQuery(channelId, enabled);
  const read = (): ChannelAccessRequestLoad => {
    if (!enabled() || query.isPending) return { status: 'loading' };
    if (!query.isFetchedAfterMount)
      return {
        status: query.isFetching || query.isPaused ? 'loading' : 'error',
      };
    if (query.isError)
      return {
        status: thrownResultErrorHasCode(query.error, 'NOT_FOUND')
          ? 'not-found'
          : 'error',
      };
    return { status: 'ready', state: query.data };
  };
  return {
    read,
    refreshing: () => query.isFetching || query.isPaused,
    refresh: () => query.refetch(),
  };
}
