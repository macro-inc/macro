import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { ApiActivity as ChannelsActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { scheduleIdle } from '@solid-primitives/scheduled';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  assertQueryAccount,
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
} from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import type { ChannelDirectory } from './directory';
import { channelKeys } from './keys';

export function channelActivityQueryOptions(
  account: QueryAccount | undefined,
  enabled: boolean
) {
  return {
    queryKey: channelKeys.activity(account?.userId).queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      assertQueryAccount(account);
      signal.throwIfAborted();
      const result = await throwOnErr(storageServiceClient.getActivity);
      signal.throwIfAborted();
      assertQueryAccount(account);
      return result;
    },
    enabled: !!account && enabled,
  };
}

export function useChannelsActivityQuery(
  enabled: Accessor<boolean> = () => true
) {
  const account = useQueryAccount();
  return useQuery(() => channelActivityQueryOptions(account(), enabled()));
}

/** Replaces the channel's row in the activity list, or adds it. */
function upsertChannelActivity(
  list: ChannelsActivity[],
  activity: ChannelsActivity
): ChannelsActivity[] {
  const index = list.findIndex((row) => row.channel_id === activity.channel_id);
  if (index === -1) return [...list, activity];
  return list.map((row, i) => (i === index ? activity : row));
}

type PendingChannelView = {
  account: QueryAccount;
  directory: Pick<ChannelDirectory, 'recordView'>;
};

async function recordChannelView(
  channelId: string,
  { account, directory }: PendingChannelView
) {
  if (!isCurrentQueryAccount(account)) return;
  const activity = await recordChannelActivity({
    channelId,
    activityType: 'view',
  });
  // The write returns the row, so the list needs no refetch.
  if (!isCurrentQueryAccount(account)) return;
  queryClient.setQueryData<ChannelsActivity[]>(
    channelKeys.activity(account.userId).queryKey,
    (list) => list && upsertChannelActivity(list, activity)
  );
  // The directory reads views from the channel record, which no soup update
  // carries for the viewer's own view.
  if (activity.viewed_at) directory.recordView(channelId, activity.viewed_at);
}

/** Idle callbacks wait at most this long behind a busy main thread. */
const CHANNEL_VIEW_MAX_WAIT_MS = 2_000;
const pendingChannelViews = new Map<string, PendingChannelView>();
// Module scope, so a view recorded as its channel unmounts still lands.
const flushChannelViews = scheduleIdle(() => {
  for (const [channelId, pending] of pendingChannelViews) {
    fireAndForget(
      recordChannelView(channelId, pending),
      'channel-view-activity'
    );
  }
  pendingChannelViews.clear();
}, CHANNEL_VIEW_MAX_WAIT_MS);

/**
 * Records that the user viewed a channel, in idle time. An acknowledged write
 * makes the normalized cache refetch every GraphQL read still in flight, and a
 * channel switch starts the next channel's detail read, so a write sent with
 * the open costs that read twice. Views of one channel that are still pending
 * share a request. The recorded view shows on the channel in `directory`.
 */
export function recordChannelViewWhenIdle(
  channelId: string,
  directory: Pick<ChannelDirectory, 'recordView'>
) {
  const account = currentQueryAccount();
  if (!account) return;
  pendingChannelViews.set(channelId, { account, directory });
  flushChannelViews();
}
