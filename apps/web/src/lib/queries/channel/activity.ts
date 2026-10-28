import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { ApiActivity as ChannelsActivity } from '@service-storage/generated/schemas/apiActivity';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { scheduleIdle } from '@solid-primitives/scheduled';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelKeys } from './keys';

function fetchChannelsActivity() {
  return throwOnErr(storageServiceClient.getActivity);
}

export function useChannelsActivityQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => ({
    queryKey: channelKeys.activity.queryKey,
    queryFn: fetchChannelsActivity,
    enabled: enabled(),
  }));
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

async function recordChannelView(channelId: string) {
  const activity = await recordChannelActivity({
    channelId,
    activityType: 'view',
  });
  // The write returns the row, so the list needs no refetch.
  queryClient.setQueryData<ChannelsActivity[]>(
    channelKeys.activity.queryKey,
    (list) => list && upsertChannelActivity(list, activity)
  );
}

/** Idle callbacks wait at most this long behind a busy main thread. */
const CHANNEL_VIEW_MAX_WAIT_MS = 2_000;
const pendingChannelViews = new Set<string>();
// Module scope, so a view recorded as its channel unmounts still lands.
const flushChannelViews = scheduleIdle(() => {
  for (const channelId of pendingChannelViews) {
    fireAndForget(recordChannelView(channelId), 'channel-view-activity');
  }
  pendingChannelViews.clear();
}, CHANNEL_VIEW_MAX_WAIT_MS);

/**
 * Records that the user viewed a channel, in idle time. An acknowledged write
 * makes the normalized cache refetch every GraphQL read still in flight, and a
 * channel switch starts the next channel's detail read, so a write sent with
 * the open costs that read twice. Views of one channel that are still pending
 * share a request.
 */
export function recordChannelViewWhenIdle(channelId: string) {
  pendingChannelViews.add(channelId);
  flushChannelViews();
}
