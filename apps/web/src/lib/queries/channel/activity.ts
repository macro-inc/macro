import { fireAndForget } from '@core/util/fireAndForget';
import { recordChannelActivity } from '@service-storage/graphql-channel-activity';
import { scheduleIdle } from '@solid-primitives/scheduled';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
} from '../auth/account-scope';
import type { ChannelDirectory } from './directory';

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
  if (!isCurrentQueryAccount(account)) return;
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
