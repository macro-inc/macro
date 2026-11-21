import {
  dismissIncomingCallEverywhere,
  type IncomingCall,
  useVisibleIncomingCalls,
} from '@app/features/block-call/sidebar/incoming-calls';
import { isNamedForPeople } from '@app/features/channel/group-chat-name';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { MAX_RING_DURATION_MS } from '@channel/Call/CallStartedNotifier';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { mapArray } from 'solid-js';
import type {
  IncomingCallPlace,
  IncomingChannelCall,
} from './core/incoming-channel-calls';

function incomingCallPlace(
  channel: Pick<ApiChannelWithLatest, 'name' | 'channel_type'> | undefined
): IncomingCallPlace {
  const name = channel?.name;
  if (!channel || !name || channel.channel_type === 'direct_message') {
    return { kind: 'direct' };
  }

  // A group chat goes by its people, which isn't a "#channel": the call is to
  // you, like a DM.
  if (channel.channel_type === 'private' && isNamedForPeople(name)) {
    return { kind: 'direct' };
  }
  return { kind: 'channel', name: name.replace(/^#+/, '') };
}

async function joinIncomingCall(channelId: string, callId: string) {
  try {
    await joinChannelCall(channelId, { kind: 'join', callId });
  } catch (error) {
    console.error('Failed to join call', error);
    toast.failure(t('calls.joinFailed'));
  }
}

/**
 * Ringing channel and DM calls for the top-of-window stack, answered with the
 * same actions as the Chat sidebar's inline Join and Decline, except calls in
 * a conversation that is open on screen, which has its own. Joining opens
 * the channel in a split, so pages without the split layout (a meeting page's
 * discussion panel) leave these to the sidebar. Each call keeps one object for
 * as long as it rings, so its banner stays mounted while others come and go.
 */
export function createIncomingChannelCalls() {
  const userId = useUserId();
  const channelsCtx = useChannelsContext();
  const ringing = useVisibleIncomingCalls();
  const canJoin = () => ENABLE_CALLS && !!globalSplitManager();
  /** Open in any split, popover or inline preview (a parked tab doesn't count). */
  const isOnScreen = (channelId: string) =>
    !!globalSplitManager()?.findOpenView({ type: 'channel', id: channelId });

  const described = mapArray(
    ringing,
    (call: IncomingCall): IncomingChannelCall => ({
      callId: call.callId,
      channelId: call.channelId,
      callerId: call.createdBy,
      get callerName() {
        return call.createdBy ? idToDisplayName(call.createdBy) : '';
      },
      get place() {
        return incomingCallPlace(channelsCtx.channelsById()[call.channelId]);
      },
      expiresAt: new Date(
        Date.parse(call.createdAt) + MAX_RING_DURATION_MS
      ).toISOString(),
    })
  );

  return {
    // A call in a conversation that's already on screen is answered from that
    // conversation's own call bar; it rings here again once it's closed.
    calls: () =>
      canJoin()
        ? described().filter((call) => !isOnScreen(call.channelId))
        : [],
    // Same join as the sidebar row; its `call.join` trace records the session
    // and outcome.
    join: (call: IncomingChannelCall) =>
      fireAndForget(
        joinIncomingCall(call.channelId, call.callId),
        'incoming-call'
      ),
    decline: (call: IncomingChannelCall) =>
      dismissIncomingCallEverywhere(call.callId, userId()),
  };
}
